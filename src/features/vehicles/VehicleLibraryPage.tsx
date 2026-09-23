import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  IconArrowLeft,
  IconChevronDown,
  IconInfoCircle,
  IconLink,
  IconPlus,
  IconSearch,
} from '@tabler/icons-react'
import { Select } from '../../components/business/Select'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../auth/context'
import './vehicles.css'

type Generation = {
  code: string
  label: string
  years: string
  power: string
  status: string
  feature?: string
  trims?: string[]
}
type Family = {
  id: string
  name: string
  category: string
  image: string
  codes: string[]
  generations: Generation[]
}
type Archive = {
  eras: {
    name: string
    codes: string
    years: string
    image: string
    familyIds: string[]
    generationCodes: string[]
  }[]
  families: Family[]
}

const familyOptions = (families: Family[]) => [
  { value: '', label: '全部车系' },
  ...families.map((family) => ({ value: family.id, label: family.name })),
]

export function VehicleLibraryPage() {
  const { familyId, generationCode } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [archive, setArchive] = useState<Archive | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [family, setFamily] = useState('')
  const [power, setPower] = useState('')
  const [status, setStatus] = useState('')
  const [years, setYears] = useState('')
  const [generations, setGenerations] = useState<string[]>([])
  const [generationOpen, setGenerationOpen] = useState(false)
  const [generationQuery, setGenerationQuery] = useState('')
  const [notice, setNotice] = useState('')
  const generationRoot = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    void api<Archive>('/vehicle-models')
      .then((data) => alive && setArchive(data))
      .catch((cause) => alive && setError(errorMessage(cause)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!generationOpen) return
    const close = (event: PointerEvent) => {
      if (!generationRoot.current?.contains(event.target as Node)) setGenerationOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [generationOpen])

  const selectedFamily = archive?.families.find((item) => item.id === familyId)
  const selectedGeneration = selectedFamily?.generations.find(
    (item) => item.code === generationCode,
  )
  const filtered = useMemo(() => {
    if (!archive) return []
    const query = search.trim().toLocaleLowerCase()
    return archive.families.flatMap((item) =>
      item.generations
        .filter(() => !family || item.id === family)
        .filter((generation) => !generations.length || generations.includes(generation.code))
        .filter((generation) => !power || generation.power.includes(power))
        .filter((generation) => !status || generation.status === status)
        .filter((generation) => !years || generation.years.includes(years))
        .filter(
          (generation) =>
            !query ||
            `${item.name} ${generation.code} ${generation.label}`
              .toLocaleLowerCase()
              .includes(query),
        )
        .map((generation) => ({ family: item, generation })),
    )
  }, [archive, family, generations, power, search, status, years])
  const filtering = Boolean(family || generations.length || power || status || years || search)

  if (loading) return <VehicleState title="正在读取车型档案…" />
  if (error)
    return (
      <VehicleState
        title="车型档案暂时无法载入"
        message={error}
        action={<button onClick={() => location.reload()}>重新载入</button>}
      />
    )
  if (!archive) return null
  if (selectedFamily && selectedGeneration)
    return (
      <GenerationDetail
        family={selectedFamily}
        generation={selectedGeneration}
        writable={user.role !== 'viewer'}
        onNotice={setNotice}
      />
    )

  const productionYears = [
    '',
    ...[
      ...new Set(
        archive.families.flatMap((item) =>
          item.generations.map((generation) => generation.years.match(/\d{4}/)?.[0] ?? ''),
        ),
      ),
    ]
      .filter(Boolean)
      .sort(),
  ]

  function clearFilters() {
    setSearch('')
    setFamily('')
    setPower('')
    setStatus('')
    setYears('')
    setGenerations([])
  }

  return (
    <div className="business vehicle-library">
      <header className="vehicle-heading">
        <div>
          <p className="vehicle-breadcrumb">
            商品资料 <span>›</span> 车型库
          </p>
          <h1>保时捷车型库</h1>
          <p>从经典车型到纯电时代，按家族与代际建立适配档案。</p>
        </div>
        {user.role !== 'viewer' && (
          <button
            className="primary"
            onClick={() => setNotice('车型新增表单将复用统一档案编辑器。')}
          >
            <IconPlus size={20} /> 新增车型
          </button>
        )}
      </header>

      <section className="vehicle-filterbar" aria-label="车型筛选">
        <label className="vehicle-search">
          <IconSearch size={19} />
          <input
            aria-label="搜索车型"
            placeholder="搜索车型、代际、底盘代号（如 992、95B）"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <Select
          label="车系"
          options={familyOptions(archive.families)}
          value={family}
          onChange={setFamily}
        />
        <div className="vehicle-generation-select" ref={generationRoot}>
          <button
            type="button"
            className={generationOpen ? 'is-open' : ''}
            aria-expanded={generationOpen}
            onClick={() => setGenerationOpen(!generationOpen)}
          >
            <span>{generations.length ? `代际：${generations.join('、')}` : '全部代际'}</span>
            <IconChevronDown size={16} />
          </button>
          {generationOpen && (
            <div className="vehicle-generation-menu">
              <label>
                <IconSearch size={16} />
                <input
                  autoFocus
                  value={generationQuery}
                  placeholder="搜索代际代码"
                  onChange={(event) => setGenerationQuery(event.target.value)}
                />
              </label>
              <div className="vehicle-generation-options">
                {archive.families.map((item) => {
                  const options = item.generations.filter((generation) =>
                    generation.code.toLowerCase().includes(generationQuery.toLowerCase()),
                  )
                  if (!options.length) return null
                  return (
                    <div key={item.id}>
                      <strong>{item.name}</strong>
                      {options.map((generation) => (
                        <label key={generation.code}>
                          <input
                            type="checkbox"
                            checked={generations.includes(generation.code)}
                            onChange={() =>
                              setGenerations((current) =>
                                current.includes(generation.code)
                                  ? current.filter((code) => code !== generation.code)
                                  : [...current, generation.code],
                              )
                            }
                          />
                          <span>{generation.code}</span>
                        </label>
                      ))}
                    </div>
                  )
                })}
              </div>
              <footer>
                <button type="button" onClick={() => setGenerations([])}>
                  重置
                </button>
                <button className="primary" type="button" onClick={() => setGenerationOpen(false)}>
                  应用筛选
                </button>
              </footer>
            </div>
          )}
        </div>
        <Select
          label="动力类型"
          options={['', '燃油', '混动', '纯电'].map((value) => ({
            value,
            label: value || '全部动力',
          }))}
          value={power}
          onChange={setPower}
        />
        <Select
          label="生产年份"
          options={productionYears.map((value) => ({
            value,
            label: value ? `${value} 年` : '全部年份',
          }))}
          value={years}
          onChange={setYears}
        />
        <Select
          label="在售状态"
          options={['', '在售', '已停产', '因市场而异'].map((value) => ({
            value,
            label: value || '全部状态',
          }))}
          value={status}
          onChange={setStatus}
        />
        {filtering && (
          <button className="vehicle-clear" onClick={clearFilters}>
            清空筛选
          </button>
        )}
      </section>

      {notice && (
        <p className="vehicle-notice" role="status">
          {notice}
        </p>
      )}
      {filtering ? (
        <FilterResults
          rows={filtered}
          onOpen={(itemFamily, generation) =>
            navigate(`/vehicles/${itemFamily.id}/${encodeURIComponent(generation.code)}`)
          }
          clear={clearFilters}
        />
      ) : (
        <ArchiveHome
          archive={archive}
          onOpen={(itemFamily, generation) =>
            navigate(`/vehicles/${itemFamily.id}/${encodeURIComponent(generation.code)}`)
          }
        />
      )}
    </div>
  )
}

function ArchiveHome({
  archive,
  onOpen,
}: {
  archive: Archive
  onOpen: (family: Family, generation: Generation) => void
}) {
  const [activeEraIndex, setActiveEraIndex] = useState<number | null>(null)
  const [previewFamilyId, setPreviewFamilyId] = useState('macan')
  const activeEra = activeEraIndex === null ? null : archive.eras[activeEraIndex]
  const visibleFamilies = activeEra
    ? archive.families.filter((family) => activeEra.familyIds.includes(family.id))
    : archive.families
  const previewFamily =
    visibleFamilies.find((family) => family.id === previewFamilyId) ?? visibleFamilies[0]
  const visibleGenerations = activeEra
    ? previewFamily.generations.filter((generation) =>
        activeEra.generationCodes.includes(generation.code),
      )
    : previewFamily.generations

  function selectEra(index: number) {
    setActiveEraIndex(index)
    setPreviewFamilyId(archive.eras[index].familyIds[0])
  }

  function showAllFamilies() {
    setActiveEraIndex(null)
    setPreviewFamilyId('macan')
  }

  return (
    <>
      <section className="vehicle-timeline">
        <div className={`vehicle-timeline-intro ${activeEra ? 'is-selected' : ''}`}>
          <strong>{activeEra ? activeEra.years : '1948 — 至今'}</strong>
          <h2>{activeEra ? activeEra.name : '量产道路车型档案'}</h2>
          <p>
            {activeEra
              ? `代表车型：${activeEra.codes}。选择其他阶段可继续浏览时代摘要。`
              : '七十余年来，Porsche 以不断进化的工程与设计，塑造独一无二的驾驶体验。'}
          </p>
        </div>
        {archive.eras.map((era, index) => {
          const selected = index === activeEraIndex
          return (
            <button
              type="button"
              className={`vehicle-era ${selected ? 'active' : ''}`}
              key={era.name}
              aria-pressed={selected}
              onClick={() => selectEra(index)}
            >
              <h3>{era.name}</h3>
              <span>{era.codes}</span>
              <img src={era.image} alt="" />
              <i />
              <small>{era.years}</small>
            </button>
          )
        })}
      </section>
      <section className="vehicle-family-section">
        <div className="vehicle-family-intro">
          <h2>{activeEra ? `${activeEra.name}车型` : '车型家族'}</h2>
          <p>
            {activeEra
              ? `已联动筛选 ${activeEra.years} 的代表车系。`
              : '选择车型家族，进入代际查看适配的零部件档案。'}
          </p>
          {activeEra && (
            <button type="button" className="vehicle-show-all" onClick={showAllFamilies}>
              显示全部车型
            </button>
          )}
        </div>
        <div className="vehicle-family-grid">
          {visibleFamilies.map((family) => (
            <button
              key={family.id}
              className={family.id === previewFamily.id ? 'active' : ''}
              aria-pressed={family.id === previewFamily.id}
              onClick={() => setPreviewFamilyId(family.id)}
            >
              <span className="vehicle-family-card-head">
                <strong>{family.name}</strong>
                <span>{family.generations.length} 代</span>
              </span>
              <img src={family.image} alt={`${family.name} 车型`} />
              <small>{family.codes.join(' / ')}</small>
            </button>
          ))}
        </div>
        <div className="vehicle-family-preview">
          <img src={previewFamily.image} alt={`${previewFamily.name} 代表车型`} />
          <div>
            <span>{previewFamily.name}</span>
            <h3>
              {previewFamily.name} · {previewFamily.codes.join(' / ')}
            </h3>
            <p>选择车型家族，继续查看具体代际与适配档案。</p>
          </div>
          <div className="vehicle-phases">
            {visibleGenerations.map((generation) => (
              <button key={generation.code} onClick={() => onOpen(previewFamily, generation)}>
                <strong>{generation.code}</strong>
                <small>{generation.years}</small>
              </button>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}

function FilterResults({
  rows,
  onOpen,
  clear,
}: {
  rows: { family: Family; generation: Generation }[]
  onOpen: (family: Family, generation: Generation) => void
  clear: () => void
}) {
  if (!rows.length)
    return (
      <VehicleState
        title="没有符合条件的车型"
        message="调整代际、动力或年份条件后再试。"
        action={<button onClick={clear}>清空筛选</button>}
      />
    )
  return (
    <section className="vehicle-results">
      <p>
        找到 <strong>{rows.length}</strong> 个产品阶段
      </p>
      <div className="vehicle-results-table">
        <header>
          <span>产品阶段</span>
          <span>年份</span>
          <span>动力</span>
          <span>识别特征</span>
          <span>车型版本</span>
          <span>状态</span>
        </header>
        {rows.map(({ family, generation }) => (
          <article
            key={`${family.id}-${generation.code}`}
            className={generation.code === '95B.3' ? 'selected' : ''}
          >
            <div className="vehicle-result-name">
              <img src={family.image} alt="" />
              <div>
                <h2>
                  {family.name} {generation.code}
                </h2>
                <p>{generation.label}</p>
              </div>
            </div>
            <span>{generation.years}</span>
            <span>{generation.power}</span>
            <span>{generation.feature || '查看代际资料'}</span>
            <div className="vehicle-trims">
              {generation.trims?.map((trim) => <i key={trim}>{trim}</i>) ?? '—'}
            </div>
            <div className="vehicle-result-action">
              <span>{generation.status}</span>
              <button onClick={() => onOpen(family, generation)}>查看代际详情</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function GenerationDetail({
  family,
  generation,
  writable,
  onNotice,
}: {
  family: Family
  generation: Generation
  writable: boolean
  onNotice: (message: string) => void
}) {
  return (
    <div className="business vehicle-detail">
      <div className="vehicle-detail-top">
        <div>
          <p className="vehicle-breadcrumb">
            商品资料 <span>›</span> 车型库 <span>›</span> {family.name} <span>›</span>{' '}
            {generation.code}
          </p>
          <Link to="/vehicles">
            <IconArrowLeft size={16} /> 返回筛选结果
          </Link>
          <h1>
            {family.name} {generation.code}
          </h1>
          <p>
            {generation.label} · {generation.power}
          </p>
        </div>
        {writable && (
          <div>
            <button onClick={() => onNotice('已进入资料编辑准备状态。')}>编辑资料</button>
            <button
              className="primary"
              onClick={() => onNotice('请在 SKU 档案中选择记录后建立适配关系。')}
            >
              <IconLink size={18} /> 关联 SKU
            </button>
          </div>
        )}
      </div>
      <section className="vehicle-detail-hero">
        <div className="vehicle-hero-image">
          <img
            src={
              family.id === 'macan' && generation.code === '95B.3'
                ? '/vehicles/macan-95b3-hero.png'
                : family.image
            }
            alt={`${family.name} ${generation.code}`}
          />
        </div>
        <dl>
          <div>
            <dt>工程代码</dt>
            <dd>{family.id === 'macan' ? '95B' : generation.code.split('.')[0]}</dd>
          </div>
          <div>
            <dt>产品阶段</dt>
            <dd>{generation.code}</dd>
          </div>
          <div>
            <dt>生产年份</dt>
            <dd>{generation.years}</dd>
          </div>
          <div>
            <dt>车身形式</dt>
            <dd>{family.category === 'SUV' ? 'SUV' : family.category}</dd>
          </div>
          <div>
            <dt>动力类型</dt>
            <dd>{generation.power}</dd>
          </div>
          <div>
            <dt>驱动形式</dt>
            <dd>{family.id === 'macan' ? '四轮驱动' : '依版本而定'}</dd>
          </div>
          <div>
            <dt>市场状态</dt>
            <dd>{generation.status}</dd>
          </div>
          {family.id === 'macan' && (
            <p>
              <IconInfoCircle size={18} />
              95B.1、95B.2、95B.3 同属第一代燃油 Macan；第二代纯电车型代码为 XAB。
            </p>
          )}
        </dl>
      </section>
      <section className="vehicle-lifecycle">
        {family.generations.map((item) => (
          <Link
            key={item.code}
            className={item.code === generation.code ? 'active' : ''}
            to={`/vehicles/${family.id}/${encodeURIComponent(item.code)}`}
          >
            <img src={family.image} alt="" />
            <span>
              <strong>{item.code}</strong>
              <small>{item.label}</small>
              <small>{item.years}</small>
            </span>
          </Link>
        ))}
      </section>
      <div className="vehicle-detail-lower">
        <section>
          <h2>快速识别</h2>
          <div className="vehicle-identify">
            {['前脸：重新设计进气口', '尾部：贯穿式灯带', '内饰：触控式中控面板'].map(
              (item, index) => (
                <div key={item}>
                  <img src={index === 0 ? '/vehicles/macan-95b3-hero.png' : family.image} alt="" />
                  <strong>{item}</strong>
                </div>
              ),
            )}
          </div>
        </section>
        <section>
          <h2>车型版本</h2>
          <table>
            <thead>
              <tr>
                <th>版本</th>
                <th>发动机</th>
                <th>驱动</th>
                <th>适配 SKU</th>
              </tr>
            </thead>
            <tbody>
              {(generation.trims ?? ['基础版']).map((trim) => (
                <tr key={trim}>
                  <td>
                    {family.name} {trim}
                  </td>
                  <td>
                    {generation.code === '95B.3' && ['S', 'GTS'].includes(trim)
                      ? '2.9T V6'
                      : '2.0T'}
                  </td>
                  <td>四轮驱动</td>
                  <td>—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  )
}

function VehicleState({
  title,
  message,
  action,
}: {
  title: string
  message?: string
  action?: ReactNode
}) {
  return (
    <div className="business vehicle-state">
      <h2>{title}</h2>
      {message && <p>{message}</p>}
      {action}
    </div>
  )
}
