package api

import (
	"fmt"
	"log"
	"math"
	"sync"
	"sync/atomic"
	"unsafe"

	"github.com/gen2brain/malgo"
)

const (
	sampleRate   = 16000
	channels     = 1
	frameSamples = 960 // 60ms at 16kHz — matches meowcaller's FrameSamples constant
)

type LiveAudioBridge struct {
	malgoCtx *malgo.AllocatedContext
	device   *malgo.Device

	captureBuf  []float32
	captureMu   sync.Mutex
	captureCond *sync.Cond

	playbackBuf []float32
	playbackMu  sync.Mutex

	// isClosed is read by ReadFrame/WriteFrame (under captureMu/playbackMu
	// respectively) and written by Close. An atomic.Bool avoids the data race
	// that existed when Close mutated it under captureMu while WriteFrame
	// read it under playbackMu. (D-AUD-004f)
	isClosed atomic.Bool
	phase    float64 // for synthetic comfort noise

	// muted is the LOCAL microphone mute flag. meowcaller has no public local
	// mute setter (its OnMuteState callback only reports the REMOTE party), so
	// we zero frames in our own AudioSource instead. Guarded by an atomic.Bool
	// because MuteCall/Wails and the meowcaller reader run on different
	// goroutines. (CALL-001)
	muted atomic.Bool

	logCounter int
}

// NewLiveAudioBridge initializes a duplex malgo hardware device at 16kHz Mono.
func NewLiveAudioBridge() (*LiveAudioBridge, error) {
	bridge := &LiveAudioBridge{
		captureBuf:  make([]float32, 0, frameSamples*10),
		playbackBuf: make([]float32, 0, frameSamples*10),
	}
	bridge.captureCond = sync.NewCond(&bridge.captureMu)

	// Initialize Malgo Context
	malgoCtx, err := malgo.InitContext(nil, malgo.ContextConfig{}, func(msg string) {
		// Uncomment for deep audio debugging: log.Printf("[malgo] %v", msg)
	})
	if err != nil {
		return nil, fmt.Errorf("failed to init malgo context: %w", err)
	}
	bridge.malgoCtx = malgoCtx

	deviceConfig := malgo.DefaultDeviceConfig(malgo.Duplex)
	deviceConfig.Capture.Format = malgo.FormatF32
	deviceConfig.Capture.Channels = channels
	deviceConfig.Playback.Format = malgo.FormatF32
	deviceConfig.Playback.Channels = channels
	deviceConfig.SampleRate = sampleRate

	onRecvFrames := func(pOutputSample, pInputSamples []byte, framecount uint32) {
		// --- CAPTURE (Mic -> captureBuf) ---
		if pInputSamples != nil {
			floatCount := len(pInputSamples) / 4
			rawSamples := unsafe.Slice((*float32)(unsafe.Pointer(&pInputSamples[0])), floatCount)

			actualChannels := floatCount / int(framecount)
			if actualChannels == 0 {
				actualChannels = 1
			}

			// Downmix to Mono if OS fed us Stereo/Multichannel
			mono := make([]float32, framecount)
			var sumSquare float64
			for i := 0; i < int(framecount); i++ {
				var sum float32
				for c := 0; c < actualChannels; c++ {
					sum += rawSamples[i*actualChannels+c]
				}
				val := sum / float32(actualChannels)
				mono[i] = val
				sumSquare += float64(val * val)
			}

			bridge.logCounter++
			if bridge.logCounter%100 == 0 { // Every ~2 seconds
				rms := math.Sqrt(sumSquare / float64(framecount))
				log.Printf("[AudioBridge] Mic Capture Active: frames=%d, channels=%d, RMS Volume=%.5f", framecount, actualChannels, rms)
			}

			bridge.captureMu.Lock()
			bridge.captureBuf = append(bridge.captureBuf, mono...)
			bridge.captureCond.Signal()
			bridge.captureMu.Unlock()
		}

		// --- PLAYBACK (playbackBuf -> Speaker) ---
		if pOutputSample != nil {
			floatCount := len(pOutputSample) / 4
			outSamples := unsafe.Slice((*float32)(unsafe.Pointer(&pOutputSample[0])), floatCount)

			actualChannels := floatCount / int(framecount)
			if actualChannels == 0 {
				actualChannels = 1
			}

			bridge.playbackMu.Lock()
			availableFrames := len(bridge.playbackBuf)
			neededFrames := int(framecount)

			var monoFrames []float32
			if availableFrames >= neededFrames {
				monoFrames = bridge.playbackBuf[:neededFrames]
				bridge.playbackBuf = bridge.playbackBuf[neededFrames:]
			} else {
				monoFrames = make([]float32, neededFrames)
				copy(monoFrames, bridge.playbackBuf)
				bridge.playbackBuf = bridge.playbackBuf[:0]
			}
			bridge.playbackMu.Unlock()

			// Upmix Mono to whatever the OS Speaker expects (Stereo etc)
			for i := range neededFrames {
				for c := 0; c < actualChannels; c++ {
					outSamples[i*actualChannels+c] = monoFrames[i]
				}
			}
		}
	}

	callbacks := malgo.DeviceCallbacks{
		Data: onRecvFrames,
	}

	device, err := malgo.InitDevice(malgoCtx.Context, deviceConfig, callbacks)
	if err != nil {
		malgoCtx.Free()
		return nil, fmt.Errorf("failed to init malgo device: %w", err)
	}
	bridge.device = device

	return bridge, nil
}

func (b *LiveAudioBridge) Start() error {
	return b.device.Start()
}

// SetMuted enables/disables local microphone muting. Thread-safe: it may be
// called from the Wails binding goroutine while ReadFrame runs in meowcaller.
// (CALL-001)
func (b *LiveAudioBridge) SetMuted(muted bool) {
	b.muted.Store(muted)
}

// IsMuted reports the current local microphone mute state. (CALL-001)
func (b *LiveAudioBridge) IsMuted() bool {
	return b.muted.Load()
}

// muteFrame is a pure helper: when muted it returns a fresh all-zero slice of
// the same length, otherwise it returns the input unchanged. The input is
// never mutated so the capture buffer/comfort-noise producer stays untouched.
// (CALL-001)
func muteFrame(frame []float32, muted bool) []float32 {
	if !muted {
		return frame
	}
	return make([]float32, len(frame))
}

// ---------------------------------------------------------
// meowcaller.AudioSource Implementation
// ---------------------------------------------------------

// ReadFrame is called by meowcaller to grab exactly 960 samples (60ms at 16kHz)
// to encode and send to WhatsApp via the MLow codec.
func (b *LiveAudioBridge) ReadFrame() ([]float32, error) {
	b.captureMu.Lock()
	defer b.captureMu.Unlock()

	if b.isClosed.Load() {
		return nil, fmt.Errorf("audio bridge closed")
	}

	// Wait until the OS audio callback has filled captureBuf with at least one
	// full frame. The Cond is signalled from the malgo data callback every time
	// new samples arrive (roughly every 10ms on Windows), so this loop typically
	// returns within 60ms at most.
	for len(b.captureBuf) < frameSamples && !b.isClosed.Load() {
		b.captureCond.Wait()
	}

	frame := make([]float32, frameSamples)
	if len(b.captureBuf) >= frameSamples {
		copy(frame, b.captureBuf[:frameSamples])
		b.captureBuf = b.captureBuf[frameSamples:]
	} else {
		// INJECT COMFORT NOISE (Very faint 400Hz sine wave)
		// This prevents OPUS from entering DTX mode (1-byte packets) on absolute silence,
		// which causes some WhatsApp clients to stall their jitter buffer and show 'Reconnecting...'
		for i := range frameSamples {
			frame[i] = float32(math.Sin(b.phase) * 0.005) // 0.5% volume
			b.phase += 2.0 * math.Pi * 400.0 / float64(sampleRate)
		}
		if b.phase > 2.0*math.Pi {
			b.phase -= 2.0 * math.Pi
		}
	}

	// Prevent buffer bloat if OS mic is faster than WhatsApp network pacing
	if len(b.captureBuf) > frameSamples*50 {
		b.captureBuf = b.captureBuf[len(b.captureBuf)-frameSamples*10:]
	}

	// Apply local mute at the very last step so BOTH the captured-audio path
	// and the comfort-noise path are silenced. The capture buffer has already
	// been drained and bloat-trimmed above, so muting never stalls the queue or
	// changes pacing. (CALL-001)
	return muteFrame(frame, b.muted.Load()), nil
}

// ---------------------------------------------------------
// meowcaller.AudioSink Implementation
// ---------------------------------------------------------

// WriteFrame is called by meowcaller with decrypted samples from WhatsApp.
func (b *LiveAudioBridge) WriteFrame(frame []float32) error {
	b.playbackMu.Lock()
	defer b.playbackMu.Unlock()

	if b.isClosed.Load() {
		return fmt.Errorf("audio bridge closed")
	}

	b.playbackBuf = append(b.playbackBuf, frame...)

	// Prevent buffer bloat if OS speaker isn't consuming fast enough
	if len(b.playbackBuf) > frameSamples*50 {
		// Drop oldest frames
		b.playbackBuf = b.playbackBuf[frameSamples*10:]
	}

	return nil
}

// Close gracefully releases OS audio hardware. Idempotent: the atomic CAS
// ensures the device/context are released exactly once even under concurrent
// callers. (D-AUD-004f)
func (b *LiveAudioBridge) Close() error {
	if !b.isClosed.CompareAndSwap(false, true) {
		return nil
	}
	// Hold captureMu while broadcasting so a ReadFrame that checked the flag
	// before it was set cannot miss the wake-up (it releases captureMu in Wait).
	b.captureMu.Lock()
	b.captureCond.Broadcast() // Wake up any pending ReadFrame calls
	b.captureMu.Unlock()

	if b.device != nil {
		b.device.Uninit()
	}
	if b.malgoCtx != nil {
		b.malgoCtx.Free()
	}
	return nil
}
