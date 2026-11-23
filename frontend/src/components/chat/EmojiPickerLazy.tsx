import data from "@emoji-mart/data"
import Picker from "@emoji-mart/react"

/**
 * Lazily-loaded emoji picker. The labelled wrapper gives the third-party widget
 * a discoverable name for assistive technology without changing its behaviour.
 */
export default function EmojiPickerLazy(props: Record<string, unknown>) {
  return (
    <div role="dialog" aria-label="Emoji picker" className="emoji-picker-lazy">
      <h2 className="sr-only">Emoji picker</h2>
      <Picker data={data} {...props} />
    </div>
  )
}
