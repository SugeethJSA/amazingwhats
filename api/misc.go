package api

import (
	"html"
	"strings"

	"github.com/lugvitc/amazingwhats/internal/misc"
	"github.com/lugvitc/amazingwhats/internal/settings"
	"github.com/lugvitc/amazingwhats/internal/store"
	"github.com/polymorfa/hypermeow/types"
)

func (a *Api) GetJIDUser(jid types.JID) string {
	return jid.User
}

func (a *Api) GetCustomCSS() string {
	return settings.GetCustomCSS()
}

func (a *Api) SetCustomCSS(css string) error {
	return settings.SetCustomCSS(css)
}

func (a *Api) GetCustomJS() string {
	return settings.GetCustomJS()
}

func (a *Api) SetCustomJS(js string) error {
	return settings.SetCustomJS(js)
}

func (a *Api) Reinitialize() error {
	return a.cw.Initialise(a.waClient)
}

func (a *Api) SaveSettings(s map[string]any) error {
	return store.SaveSettings(s)
}

func (a *Api) GetSettings() map[string]any {
	return store.GetSettings()
}

// MinimizeToTray reports the General > "Minimize to system tray" setting.
// The frontend persists it through SaveSettings; reading it at close time (not
// caching it at startup) makes toggles take effect immediately. Default true
// matches the shipped setting and the tray-first close behaviour.
func (a *Api) MinimizeToTray() bool {
	value, ok := a.GetSettings()["minimizeToTray"]
	if !ok || value == nil {
		return true
	}
	enabled, ok := value.(bool)
	if !ok {
		return true
	}
	return enabled
}

func replaceMentions(text string, mentionedJIDs []string, a *Api) string {
	result := text

	for _, jid := range mentionedJIDs {
		parsedJID, err := types.ParseJID(jid)
		if err != nil {
			continue
		}
		parsedJID = canonicalUserJID(a.ctx, a.waClient, parsedJID)
		contact, _ := a.waClient.Store.Contacts.GetContact(a.ctx, parsedJID)
		displayName := contact.FullName
		if displayName == "" {
			displayName = "~ " + contact.PushName
		}
		if displayName == "" {
			displayName = parsedJID.User
		}

		mentionPattern := "@" + strings.Split(jid, "@")[0]
		mentionHTML := `<span class="mention">@` + html.EscapeString(displayName) + `</span>`
		result = strings.ReplaceAll(result, mentionPattern, mentionHTML)
	}

	return result
}

func (a *Api) GetProfileColor(jidStr string) string {
	return misc.GetProfileColor(jidStr)
}
