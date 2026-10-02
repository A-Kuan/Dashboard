import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowsClockwise, CalendarBlank, CheckCircle, Clock, CloudArrowDown, Database, Funnel, LinkSimple, MagnifyingGlass, Play, Plus, WarningCircle } from '@phosphor-icons/react'
import { listCatalogEpcConnectorRuns, retryCatalogEpcConnectorRun } from '../services/catalogApi'
import '../sku-epc-runs.css'

const stateMeta = {
  running: { label: '运行中', note: '正在等待上游响应', className: 'running' },
  succeeded: { label: '成功', note: '已生成写入前预览', className: 'succeeded' },
  failed: { label: '失败', note: '已安全留痕，可重新尝试', className: 'failed' },
}

function displayTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value))
}

function displayDuration(run) {
  if (!run?.completedAt) return run?.state === 'running' ? '进行中' : '—'
  const milliseconds = Math.max(0, new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime())
  if (milliseconds < 1000) return `${milliseconds} ms`
  if (milliseconds < 60000) return `${(milliseconds / 1000).toFixed(1)} 秒`
  return `${Math.floor(milliseconds / 60000)} 分 ${Math.round((milliseconds % 60000) / 1000)} 秒`
}

function runTitle(run, connectorLabels) {
  return connectorLabels[run.connectorId] || run.connectorId
}

function querySummary(run) {
  const query = run.requestContext || {}
  return query.vin || query.catalogPath || query.groupCode || '未记录查询条件'
}

export function EpcConnectorRunCenter({ connectors = [], onBack, onShowBatches, onNewBatch, onOpenPreview, onNotify }) {
  const [filters, setFilters] = useState({ state: '', connectorId: '', query: '', from: '', to: '' })
  const [queryDraft, setQueryDraft] = useState('')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState({ items: [], total: 0, summary: { total: 0, running: 0, succeeded: 0, failed: 0 }, page: 1, pageSize: 30 })
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [retryingId, setRetryingId] = useState('')
  const [error, setError] = useState('')
  const connectorLabels = useMemo(() => Object.fromEntries(connectors.map((connector) => [connector.id, connector.label])), [connectors])
  const selected = result.items.find((run) => run.id === selectedId) || result.items[0] || null
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize))

  const loadRuns = useCallback(async (preferredId = '') => {
    setLoading(true)
    try {
      const next = await listCatalogEpcConnectorRuns({ ...filters, page, pageSize: 30 })
      setResult(next)
      setSelectedId((current) => {
        const wanted = preferredId || current
        return next.items.some((item) => item.id === wanted) ? wanted : next.items[0]?.id || ''
      })
      setError('')
    } catch (nextError) {
      setError(nextError.message)
    } finally {
      setLoading(false)
    }
  }, [filters, page])

  useEffect(() => { loadRuns() }, [loadRuns])

  const updateFilter = (key, value) => {
    setPage(1)
    setFilters((current) => ({ ...current, [key]: value }))
  }

  const retry = async () => {
    if (!selected || selected.state !== 'failed') return
    setRetryingId(selected.id); setError('')
    try {
      const preview = await retryCatalogEpcConnectorRun(selected.id)
      onNotify?.('连接器重试成功，已生成新的写入前预览')
      onOpenPreview?.(preview.id)
    } catch (nextError) {
      setError(nextError.message)
      await loadRuns(nextError.details?.connectorRunId || '')
    } finally {
      setRetryingId('')
    }
  }

  const clearFilters = () => {
    setQueryDraft('')
    setPage(1)
    setFilters({ state: '', connectorId: '', query: '', from: '', to: '' })
  }

  return (
    <main className="epc-intake epc-run-center">
      <header className="epc-intake-topbar">
        <button type="button" onClick={onBack}><ArrowLeft size={20} weight="bold" />返回资料库</button>
        <div><span>外部目录运营</span><h1>EPC 运行中心</h1><p>查看每次连接器调用、失败原因、重试链与关联预览。</p></div>
        <button className="epc-run-new" type="button" onClick={onNewBatch}><Plus size={18} weight="bold" />新建采集</button>
      </header>

      <div className="epc-run-body">
        <nav className="epc-ops-tabs" aria-label="EPC 记录类型">
          <button type="button" onClick={onShowBatches}>证据批次</button>
          <button className="active" type="button" aria-current="page">连接器运行</button>
          <span>运行记录只追加、不覆盖，失败重试会建立新的关联记录。</span>
        </nav>

        <section className="epc-run-metrics" aria-label="连接器运行概况">
          <article><span><Database size={20} weight="duotone" />全部运行</span><strong>{result.summary?.total || 0}</strong><small>当前筛选范围</small></article>
          <article><span><CheckCircle size={20} weight="duotone" />成功</span><strong>{result.summary?.succeeded || 0}</strong><small>已生成匹配预览</small></article>
          <article><span><WarningCircle size={20} weight="duotone" />失败</span><strong>{result.summary?.failed || 0}</strong><small>等待复核或重试</small></article>
          <article><span><Clock size={20} weight="duotone" />运行中</span><strong>{result.summary?.running || 0}</strong><small>尚未完成的调用</small></article>
        </section>

        <section className="epc-run-toolbar">
          <form onSubmit={(event) => { event.preventDefault(); updateFilter('query', queryDraft) }}>
            <MagnifyingGlass size={19} />
            <input aria-label="搜索连接器运行" value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} placeholder="搜索 VIN、目录路径、图组或连接器" />
            <button type="submit">搜索</button>
          </form>
          <label><Funnel size={17} /><span>状态</span><select aria-label="运行状态" value={filters.state} onChange={(event) => updateFilter('state', event.target.value)}><option value="">全部</option><option value="failed">失败</option><option value="succeeded">成功</option><option value="running">运行中</option></select></label>
          <label><CloudArrowDown size={17} /><span>连接器</span><select aria-label="连接器筛选" value={filters.connectorId} onChange={(event) => updateFilter('connectorId', event.target.value)}><option value="">全部</option>{connectors.map((connector) => <option key={connector.id} value={connector.id}>{connector.label}</option>)}</select></label>
          <label className="epc-run-date"><CalendarBlank size={17} /><span>从</span><input aria-label="开始日期" type="date" value={filters.from} onChange={(event) => updateFilter('from', event.target.value)} /></label>
          <label className="epc-run-date"><span>至</span><input aria-label="结束日期" type="date" value={filters.to} min={filters.from} onChange={(event) => updateFilter('to', event.target.value)} /></label>
          {(filters.state || filters.connectorId || filters.query || filters.from || filters.to) ? <button className="epc-run-clear" type="button" onClick={clearFilters}>清除筛选</button> : null}
        </section>

        <div className="epc-run-workspace">
          <section className="epc-run-list-panel">
            <header><div><h2>运行队列</h2><p>{loading ? '正在同步…' : `找到 ${result.total} 条记录`}</p></div><button type="button" disabled={loading} onClick={() => loadRuns()}><ArrowsClockwise size={17} />刷新</button></header>
            <div className="epc-run-table-head"><span>连接器 / 查询</span><span>状态</span><span>结果</span><span>开始时间</span><span>耗时</span></div>
            <div className="epc-run-list">
              {result.items.map((run) => {
                const meta = stateMeta[run.state] || stateMeta.failed
                return <button type="button" className={selected?.id === run.id ? 'selected' : ''} key={run.id} onClick={() => setSelectedId(run.id)}>
                  <span><strong>{runTitle(run, connectorLabels)}</strong><small>{querySummary(run)}</small>{run.retryOf ? <em><ArrowsClockwise size={12} />重试记录</em> : null}</span>
                  <span className={`epc-run-state ${meta.className}`}>{meta.label}</span>
                  <span>{run.state === 'succeeded' ? `${run.responseSummary?.items || 0} 条零件` : run.state === 'failed' ? run.error?.code || '采集失败' : '等待结果'}</span>
                  <time>{displayTime(run.startedAt)}</time>
                  <span>{displayDuration(run)}</span>
                </button>
              })}
              {!loading && !result.items.length ? <div className="epc-run-empty"><Database size={38} weight="duotone" /><strong>{result.summary?.total ? '没有符合条件的运行记录' : '还没有连接器运行记录'}</strong><span>{result.summary?.total ? '调整筛选条件，或清除筛选查看全部记录。' : '使用连接器读取一次目录后，调用结果会永久保存在这里。'}</span>{result.summary?.total ? <button type="button" onClick={clearFilters}>清除筛选</button> : <button type="button" onClick={onNewBatch}>开始第一次采集</button>}</div> : null}
              {loading ? <div className="epc-run-loading">正在读取连接器运行记录…</div> : null}
            </div>
            <footer><span>第 {result.page} / {totalPages} 页</span><div><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}><ArrowLeft size={15} />上一页</button><button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>下一页<ArrowRight size={15} /></button></div></footer>
          </section>

          <aside className="epc-run-inspector">
            {selected ? <>
              <header><div><span>运行详情</span><strong>{selected.id.slice(0, 8).toUpperCase()}</strong></div><span className={`epc-run-state ${(stateMeta[selected.state] || stateMeta.failed).className}`}>{(stateMeta[selected.state] || stateMeta.failed).label}</span></header>
              <div className="epc-run-inspector-scroll">
                <section><h3>查询上下文</h3><dl><div><dt>连接器</dt><dd>{runTitle(selected, connectorLabels)}</dd></div><div><dt>VIN</dt><dd>{selected.requestContext?.vin || '—'}</dd></div><div><dt>目录路径</dt><dd>{selected.requestContext?.catalogPath || '—'}</dd></div><div><dt>图组编码</dt><dd>{selected.requestContext?.groupCode || '—'}</dd></div></dl></section>
                {selected.state === 'failed' ? <section className="epc-run-error"><div><WarningCircle size={20} weight="fill" /><h3>失败原因</h3></div><strong>{selected.error?.code || 'EPC_CONNECTOR_FAILED'}</strong><p>{selected.error?.message || '连接器调用失败，未返回更多安全信息。'}</p></section> : null}
                {selected.state === 'succeeded' ? <section><h3>采集结果</h3><div className="epc-run-result-grid"><article><strong>{selected.responseSummary?.items || 0}</strong><span>零件记录</span></article><article><strong>{selected.responseSummary?.assets || 0}</strong><span>图组资源</span></article></div><dl><div><dt>来源系统</dt><dd>{selected.responseSummary?.sourceSystem || '—'}</dd></div><div><dt>目录路径</dt><dd>{selected.responseSummary?.catalogPath || '—'}</dd></div></dl></section> : null}
                <section><h3>审计信息</h3><dl><div><dt>开始时间</dt><dd>{displayTime(selected.startedAt)}</dd></div><div><dt>完成时间</dt><dd>{displayTime(selected.completedAt)}</dd></div><div><dt>运行耗时</dt><dd>{displayDuration(selected)}</dd></div><div><dt>操作人</dt><dd>{selected.createdBy || '—'}</dd></div></dl>{selected.retryOf ? <p className="epc-run-link"><ArrowsClockwise size={16} />重试自 <button type="button" onClick={() => setSelectedId(selected.retryOf)}>{selected.retryOf.slice(0, 8).toUpperCase()}</button></p> : null}{selected.previewId ? <p className="epc-run-link"><LinkSimple size={16} />关联预览 <button type="button" onClick={() => onOpenPreview?.(selected.previewId)}>{selected.previewId.slice(0, 8).toUpperCase()}</button></p> : null}</section>
              </div>
              <footer>{selected.state === 'failed' ? <button type="button" disabled={retryingId === selected.id} onClick={retry}><Play size={18} weight="fill" />{retryingId === selected.id ? '正在重试…' : '使用原条件重试'}</button> : selected.previewId ? <button type="button" onClick={() => onOpenPreview?.(selected.previewId)}>打开匹配预览<ArrowRight size={18} weight="bold" /></button> : <span>{stateMeta[selected.state]?.note}</span>}</footer>
            </> : <div className="epc-run-no-selection"><Database size={38} weight="duotone" /><strong>选择一条运行记录</strong><span>这里会显示查询上下文、结果、错误和重试关系。</span></div>}
          </aside>
        </div>
      </div>
      <footer className="epc-actionbar"><div><CheckCircle size={19} weight="fill" /><span>连接器地址与密钥不会进入浏览器或运行记录；这里只显示安全的查询上下文。</span></div>{error ? <p><WarningCircle size={18} />{error}</p> : null}</footer>
    </main>
  )
}
