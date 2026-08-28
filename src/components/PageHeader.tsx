import { formatDate } from '../utils/whoop'

interface Props {
  title: string
  date?: string | null
  right?: React.ReactNode
  onPrev?: () => void
  onNext?: () => void
  hasPrev?: boolean
  hasNext?: boolean
}

export default function PageHeader({ title, date, right, onPrev, onNext, hasPrev, hasNext }: Props) {
  return (
    <div className="mb-3 flex items-start justify-between border-b border-white/[0.06] bg-gradient-to-b from-bhr-green/[0.08] to-transparent px-5 pt-14 pb-5 safe-top">
      <div>
        <p className="mb-1 text-[9px] font-black uppercase tracking-[0.24em] text-bhr-green">BHR Health 2.0</p>
        <h1 className="text-3xl font-black tracking-[-0.035em]">{title}</h1>
        {date && (
          <div className="flex items-center gap-2 mt-0.5">
            {onPrev && (
              <button
                onClick={onPrev}
                disabled={!hasPrev}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.05] text-gray-300 disabled:opacity-20 text-base leading-none -ml-1"
              >
                ‹
              </button>
            )}
            <p className="text-gray-400 text-sm capitalize">{formatDate(date)}</p>
            {onNext && (
              <button
                onClick={onNext}
                disabled={!hasNext}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.05] text-gray-300 disabled:opacity-20 text-base leading-none"
              >
                ›
              </button>
            )}
          </div>
        )}
      </div>
      {right && <div className="flex-shrink-0 ml-4 mt-1">{right}</div>}
    </div>
  )
}
