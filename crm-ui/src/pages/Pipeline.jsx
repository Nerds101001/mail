import { useCRM } from '../store'
import { PIPELINE_STAGES, STAGE_COLORS } from '../utils'
import { PageHeader } from '../components/ui'
import { Flame } from 'lucide-react'

const VISIBLE = ['COLD','CONTACTED','OPENED','HOT','DEMO','QUOTED','WON','LOST']

export default function Pipeline() {
  const { leads, setLeads, pushToRedis } = useCRM()

  function changeStage(id, stage) {
    setLeads(leads.map(l => l.id === id ? { ...l, pipelineStage: stage } : l))
    pushToRedis()
  }

  return (
    <div>
      <PageHeader title="Lead Pipeline" subtitle="Drag leads between stages or use the stage selector" />
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${VISIBLE.length}, minmax(160px, 1fr))` }}>
        {VISIBLE.map(stage => {
          const items = leads.filter(l => l.pipelineStage === stage)
          const sc = STAGE_COLORS[stage] || STAGE_COLORS.COLD
          return (
            <div key={stage} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className={`px-3 py-2.5 border-b border-slate-100 flex items-center justify-between ${sc.bg}`}>
                <span className={`text-xs font-bold uppercase tracking-wide ${sc.text}`}>{stage}</span>
                <span className="bg-white/70 text-slate-600 text-xs font-bold px-2 py-0.5 rounded-full">{items.length}</span>
              </div>
              <div className="p-2 space-y-2 min-h-[120px]">
                {items.length === 0 && (
                  <div className="text-center py-6 text-xs text-slate-300">Empty</div>
                )}
                {items.map(l => {
                  const isHot = (l.opens >= 2 || l.clicks >= 1)
                  return (
                    <div key={l.id} className="bg-slate-50 hover:bg-white border border-slate-200 hover:border-emerald-300 hover:shadow-sm rounded-lg p-2.5 transition-all duration-150 cursor-pointer group">
                      <div className="flex items-start justify-between gap-1 mb-1">
                        <p className="text-xs font-semibold text-slate-800 leading-tight">{l.name}</p>
                        {isHot && <Flame size={11} className="text-red-500 flex-shrink-0" />}
                      </div>
                      <p className="text-[10px] text-slate-400 font-mono truncate mb-2">{l.company || l.email}</p>
                      <div className="flex items-center justify-between">
                        <div className="flex gap-1">
                          {l.opens > 0 && <span className="text-[10px] text-slate-400">👁{l.opens}</span>}
                          {l.clicks > 0 && <span className="text-[10px] text-red-400">🖱{l.clicks}</span>}
                        </div>
                        <select
                          className="text-[10px] border border-slate-200 rounded px-1 py-0.5 bg-white text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          value={stage}
                          onChange={e => changeStage(l.id, e.target.value)}
                          onClick={e => e.stopPropagation()}
                        >
                          {PIPELINE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
