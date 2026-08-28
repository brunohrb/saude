interface Props {
  label: string
  value: string | number | null | undefined
  unit?: string
  sub?: string
  color?: string
  icon?: React.ReactNode
}

export default function MetricCard({ label, value, unit, sub, color, icon }: Props) {
  return (
    <div className="glass-card rounded-2xl p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-gray-400 text-xs font-medium uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <div className="flex items-baseline gap-1.5 mt-1">
        <span className="text-2xl font-bold" style={color ? { color } : undefined}>
          {value != null && value !== '' ? value : '--'}
        </span>
        {unit && <span className="text-gray-400 text-sm">{unit}</span>}
      </div>
      {sub && <span className="text-gray-500 text-xs">{sub}</span>}
    </div>
  )
}
