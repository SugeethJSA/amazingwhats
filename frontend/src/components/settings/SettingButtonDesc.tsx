import Button from "./ToggleButton"
interface SettingButtonDescProps {
  title: string
  description: string
  isEnabled: boolean
  onToggle: () => void
}

const SettingButtonDesc = ({ title, description, isEnabled, onToggle }: SettingButtonDescProps) => {
  return (
    <div className="flex flex-row justify-between items-start py-4">
      <div className="flex flex-col flex-1 pr-6">
        <h3 className="text-lg font-medium text-light-text dark:text-dark-text">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-light-muted dark:text-dark-muted">
          {description}
        </p>
      </div>
      <Button isEnabled={isEnabled} onToggle={onToggle} ariaLabel={title} />
    </div>
  )
}

export default SettingButtonDesc
