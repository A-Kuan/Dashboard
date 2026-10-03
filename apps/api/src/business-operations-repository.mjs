const workItemKinds = new Set([
  'inquiry_follow_up',
  'sales_order',
  'purchase_order',
  'receivable',
  'payable',
  'after_sales_review',
  'after_sales_receipt',
  'customer_refund',
  'supplier_return_review',
  'supplier_return_shipment',
  'supplier_refund',
])
const urgencyLevels = new Set(['overdue', 'today', 'upcoming', 'normal', 'unscheduled'])

function clean(value) { return String(value ?? '').trim() }
function number(value) { return Number(value || 0) }
function problem(errorCode, message, details) {
  return Object.assign(new Error(message), { errorCode, statusCode: 400, ...(details ? { details } : {}) })
}

function mapWorkItem(row) {
  return {
    id: row.id,
    kind: row.kind,
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceNo: row.source_no,
    status: row.status,
    title: row.title,
    counterpartName: row.counterpart_name,
    customerPartnerId: row.customer_partner_id,
    supplierPartnerId: row.supplier_partner_id,
    assignedTo: row.assigned_to,
    nextAction: row.next_action,
    actionCapability: row.action_capability,
    routePath: row.route_path,
    dueAt: row.due_at,
    urgency: row.urgency,
    overdueDays: number(row.overdue_days),
    amount: number(row.amount),
    currency: row.currency,
    details: row.details || {},
    updatedAt: row.updated_at,
  }
}

function emptyExposure() {
  return { receivable: {}, payable: {}, customerRefund: {}, supplierRefund: {} }
}

function addCurrencyAmount(bucket, currency, value) {
  bucket[currency] = Math.round((number(bucket[currency]) + number(value)) * 100) / 100
}

const workItemsCte = `WITH work_items AS (
  SELECT
    'inquiry:'||i.id id,
    'inquiry_follow_up'::text kind,
    'inquiry'::text source_type,
    i.id source_id,
    i.inquiry_no source_no,
    i.status,
    '跟进询价：'||i.customer_name title,
    i.customer_name counterpart_name,
    i.customer_partner_id,
    NULL::text supplier_partner_id,
    i.assigned_to,
    COALESCE(NULLIF(i.next_action,''),CASE i.status
      WHEN 'new' THEN '核对需求并开始询价'
      WHEN 'sourcing' THEN '补齐供应商报价'
      WHEN 'quoting' THEN '完成并发送对客报价'
      WHEN 'quoted' THEN '跟进客户报价反馈'
      WHEN 'follow_up' THEN '确认客户决策与下一步'
      ELSE '处理询价'
    END) next_action,
    'business.manage'::text action_capability,
    '/business/inquiries/'||i.id route_path,
    COALESCE(i.next_action_at,((latest_quote.valid_until+time '23:59:59') AT TIME ZONE 'Asia/Shanghai')) due_at,
    COALESCE(i.quote_amount,latest_quote.total_amount,0)::numeric amount,
    i.currency,
    jsonb_build_object(
      'priority',i.priority,
      'vehicleLabel',i.vehicle_label,
      'vin',i.vin,
      'quoteId',COALESCE(latest_quote.id,''),
      'quoteNo',COALESCE(latest_quote.quote_no,''),
      'quoteValidUntil',latest_quote.valid_until
    ) details,
    i.updated_at,
    CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 10 ELSE 20 END base_rank
  FROM business_inquiry i
  LEFT JOIN LATERAL (
    SELECT q.id,q.quote_no,q.valid_until,q.total_amount
    FROM business_quote q
    WHERE q.inquiry_id=i.id AND q.state='sent'
    ORDER BY q.sent_at DESC NULLS LAST,q.created_at DESC,q.id DESC
    LIMIT 1
  ) latest_quote ON true
  WHERE i.status IN ('new','sourcing','quoting','quoted','follow_up')

  UNION ALL

  SELECT
    'sales-order:'||s.id,
    'sales_order',
    'sales_order',
    s.id,
    s.order_no,
    s.status,
    '销售履约：'||s.customer_name,
    s.customer_name,
    s.customer_partner_id,
    NULL::text,
    i.assigned_to,
    CASE s.status WHEN 'draft' THEN '确认销售订单' WHEN 'confirmed' THEN '推进采购到货与库存准备' ELSE '完成发货与交付' END,
    'business.order',
    '/business/sales-orders/'||s.id,
    NULL::timestamptz,
    s.total_amount,
    s.currency,
    jsonb_build_object('inquiryId',s.inquiry_id,'inquiryNo',i.inquiry_no,'vehicleLabel',s.vehicle_label,'vin',s.vin),
    s.updated_at,
    40
  FROM business_sales_order s
  JOIN business_inquiry i ON i.id=s.inquiry_id
  WHERE s.status IN ('draft','confirmed','fulfilling')

  UNION ALL

  SELECT
    'purchase-order:'||p.id,
    'purchase_order',
    'purchase_order',
    p.id,
    p.order_no,
    p.status,
    '采购履约：'||p.supplier_name,
    p.supplier_name,
    s.customer_partner_id,
    p.supplier_partner_id,
    i.assigned_to,
    CASE p.status WHEN 'draft' THEN '确认并提交采购单' WHEN 'partially_received' THEN '跟进剩余配件到货' ELSE '跟进供应商到货' END,
    'business.order',
    '/business/purchase-orders/'||p.id,
    CASE WHEN p.expected_at IS NULL THEN NULL ELSE ((p.expected_at+time '23:59:59') AT TIME ZONE 'Asia/Shanghai') END,
    p.total_amount,
    p.currency,
    jsonb_build_object(
      'salesOrderId',p.sales_order_id,
      'salesOrderNo',s.order_no,
      'expectedAt',p.expected_at,
      'remainingQuantity',COALESCE((SELECT sum(pi.quantity-pi.received_quantity) FROM business_purchase_order_item pi WHERE pi.purchase_order_id=p.id),0)
    ),
    p.updated_at,
    30
  FROM business_purchase_order p
  JOIN business_sales_order s ON s.id=p.sales_order_id
  JOIN business_inquiry i ON i.id=p.inquiry_id
  WHERE p.status IN ('draft','submitted','confirmed','partially_received')

  UNION ALL

  SELECT
    'receivable:'||r.id,
    'receivable',
    'receivable',
    r.id,
    r.receivable_no,
    r.status,
    '客户收款：'||r.customer_name,
    r.customer_name,
    r.customer_partner_id,
    NULL::text,
    i.assigned_to,
    '跟进客户回款',
    'business.finance',
    '/business/receivables/'||r.id,
    ((r.due_at+time '23:59:59') AT TIME ZONE 'Asia/Shanghai'),
    GREATEST((r.original_amount-r.credited_amount)-(r.paid_amount-r.refunded_amount),0),
    r.currency,
    jsonb_build_object('salesOrderId',r.sales_order_id,'salesOrderNo',s.order_no,'adjustedAmount',r.original_amount-r.credited_amount,'netCollectedAmount',r.paid_amount-r.refunded_amount),
    r.updated_at,
    0
  FROM business_receivable r
  JOIN business_sales_order s ON s.id=r.sales_order_id
  JOIN business_inquiry i ON i.id=s.inquiry_id
  WHERE r.status IN ('open','partial')

  UNION ALL

  SELECT
    'payable:'||a.id,
    'payable',
    'payable',
    a.id,
    a.payable_no,
    a.status,
    '供应商付款：'||a.supplier_name,
    a.supplier_name,
    s.customer_partner_id,
    a.supplier_partner_id,
    i.assigned_to,
    '安排供应商付款',
    'business.finance',
    '/business/payables/'||a.id,
    ((a.due_at+time '23:59:59') AT TIME ZONE 'Asia/Shanghai'),
    GREATEST((a.original_amount-a.credited_amount)-(a.paid_amount-a.refunded_amount),0),
    a.currency,
    jsonb_build_object('purchaseOrderId',a.purchase_order_id,'purchaseOrderNo',p.order_no,'adjustedAmount',a.original_amount-a.credited_amount,'netPaidAmount',a.paid_amount-a.refunded_amount),
    a.updated_at,
    50
  FROM business_payable a
  JOIN business_purchase_order p ON p.id=a.purchase_order_id
  JOIN business_sales_order s ON s.id=a.sales_order_id
  JOIN business_inquiry i ON i.id=s.inquiry_id
  WHERE a.status IN ('open','partial')

  UNION ALL

  SELECT
    'after-sales:'||c.id,
    CASE c.status WHEN 'requested' THEN 'after_sales_review' WHEN 'refund_pending' THEN 'customer_refund' ELSE 'after_sales_receipt' END,
    'after_sales',
    c.id,
    c.case_no,
    c.status,
    '客户售后：'||c.customer_name,
    c.customer_name,
    c.customer_partner_id,
    NULL::text,
    i.assigned_to,
    CASE c.status WHEN 'requested' THEN '独立审核售后申请' WHEN 'refund_pending' THEN '向客户完成退款' ELSE '接收客户退回配件' END,
    CASE c.status WHEN 'requested' THEN 'business.after_sales.review' WHEN 'refund_pending' THEN 'business.finance' ELSE 'business.inventory' END,
    '/business/after-sales/'||c.id,
    ((((c.updated_at AT TIME ZONE 'Asia/Shanghai')::date)+time '23:59:59') AT TIME ZONE 'Asia/Shanghai'),
    CASE WHEN c.status='refund_pending' THEN GREATEST(c.credited_amount-c.refunded_amount,0) ELSE GREATEST(c.requested_refund_amount-c.credited_amount,0) END,
    s.currency,
    jsonb_build_object('salesOrderId',c.sales_order_id,'salesOrderNo',s.order_no,'reasonCode',c.reason_code,'creditedAmount',c.credited_amount,'refundedAmount',c.refunded_amount),
    c.updated_at,
    CASE c.status WHEN 'requested' THEN 0 WHEN 'refund_pending' THEN 0 ELSE 10 END
  FROM business_after_sales_case c
  JOIN business_sales_order s ON s.id=c.sales_order_id
  JOIN business_inquiry i ON i.id=s.inquiry_id
  WHERE c.status IN ('requested','approved','partially_received','refund_pending')

  UNION ALL

  SELECT
    'supplier-return:'||c.id,
    CASE c.status WHEN 'requested' THEN 'supplier_return_review' WHEN 'refund_pending' THEN 'supplier_refund' ELSE 'supplier_return_shipment' END,
    'supplier_return',
    c.id,
    c.return_no,
    c.status,
    '供应商退货：'||c.supplier_name,
    c.supplier_name,
    s.customer_partner_id,
    c.supplier_partner_id,
    i.assigned_to,
    CASE c.status WHEN 'requested' THEN '独立审核供应商退货' WHEN 'refund_pending' THEN '跟进供应商退款' ELSE '将核准配件退回供应商' END,
    CASE c.status WHEN 'requested' THEN 'business.purchase_return.review' WHEN 'refund_pending' THEN 'business.finance' ELSE 'business.inventory' END,
    '/business/supplier-returns/'||c.id,
    ((((c.updated_at AT TIME ZONE 'Asia/Shanghai')::date)+time '23:59:59') AT TIME ZONE 'Asia/Shanghai'),
    CASE WHEN c.status='refund_pending' THEN GREATEST(c.credited_amount-c.refunded_amount,0) ELSE GREATEST(c.requested_credit_amount-c.credited_amount,0) END,
    p.currency,
    jsonb_build_object('purchaseOrderId',c.purchase_order_id,'purchaseOrderNo',p.order_no,'reasonCode',c.reason_code,'creditedAmount',c.credited_amount,'refundedAmount',c.refunded_amount),
    c.updated_at,
    CASE c.status WHEN 'requested' THEN 0 WHEN 'refund_pending' THEN 0 ELSE 10 END
  FROM business_supplier_return_case c
  JOIN business_purchase_order p ON p.id=c.purchase_order_id
  JOIN business_sales_order s ON s.id=p.sales_order_id
  JOIN business_inquiry i ON i.id=p.inquiry_id
  WHERE c.status IN ('requested','approved','partially_shipped','refund_pending')
), classified AS (
  SELECT work_items.*,
    CASE
      WHEN due_at IS NULL THEN 'unscheduled'
      WHEN due_at<$1::timestamptz THEN 'overdue'
      WHEN due_at<((date_trunc('day',$1::timestamptz AT TIME ZONE 'Asia/Shanghai')+interval '1 day') AT TIME ZONE 'Asia/Shanghai') THEN 'today'
      WHEN due_at<((date_trunc('day',$1::timestamptz AT TIME ZONE 'Asia/Shanghai')+interval '8 days') AT TIME ZONE 'Asia/Shanghai') THEN 'upcoming'
      ELSE 'normal'
    END urgency,
    CASE
      WHEN due_at IS NOT NULL AND due_at<$1::timestamptz THEN floor(extract(epoch FROM ($1::timestamptz-due_at))/86400)::int
      ELSE 0
    END overdue_days,
    base_rank+CASE
      WHEN due_at IS NOT NULL AND due_at<$1::timestamptz THEN 0
      WHEN due_at IS NOT NULL AND due_at<((date_trunc('day',$1::timestamptz AT TIME ZONE 'Asia/Shanghai')+interval '1 day') AT TIME ZONE 'Asia/Shanghai') THEN 100
      WHEN due_at IS NOT NULL AND due_at<((date_trunc('day',$1::timestamptz AT TIME ZONE 'Asia/Shanghai')+interval '8 days') AT TIME ZONE 'Asia/Shanghai') THEN 200
      WHEN due_at IS NOT NULL THEN 300
      ELSE 400
    END priority_rank
  FROM work_items
)`

export function createBusinessOperationsRepository(pool) {
  return {
    async listWorkItems({ query = '', kind = '', urgency = '', assignedTo = '', page = 1, pageSize = 30, now = new Date() } = {}) {
      const workKind = clean(kind)
      const urgencyLevel = clean(urgency)
      if (workKind && !workItemKinds.has(workKind)) throw problem('INVALID_WORK_ITEM_KIND', '业务跟进类型无效', { kind: workKind })
      if (urgencyLevel && !urgencyLevels.has(urgencyLevel)) throw problem('INVALID_WORK_ITEM_URGENCY', '业务跟进紧急程度无效', { urgency: urgencyLevel })
      const asOf = now instanceof Date ? now : new Date(now)
      if (Number.isNaN(asOf.getTime())) throw problem('INVALID_WORK_ITEM_AS_OF', '业务跟进统计时间无效')
      const currentPage = Math.max(1, Math.trunc(Number(page) || 1))
      const size = Math.min(100, Math.max(1, Math.trunc(Number(pageSize) || 30)))
      const values = [asOf.toISOString()]
      const where = []
      const term = clean(query)
      if (term) {
        values.push(`%${term}%`)
        where.push(`(source_no ILIKE $${values.length} OR title ILIKE $${values.length} OR counterpart_name ILIKE $${values.length} OR next_action ILIKE $${values.length})`)
      }
      if (workKind) { values.push(workKind); where.push(`kind=$${values.length}`) }
      if (urgencyLevel) { values.push(urgencyLevel); where.push(`urgency=$${values.length}`) }
      if (clean(assignedTo)) { values.push(clean(assignedTo)); where.push(`assigned_to=$${values.length}`) }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const summaryValues = [...values]
      values.push(size, (currentPage - 1) * size)
      const [itemsResult, summaryResult] = await Promise.all([
        pool.query(`${workItemsCte}
          SELECT * FROM classified ${clause}
          ORDER BY priority_rank,due_at NULLS LAST,updated_at,id
          LIMIT $${values.length - 1} OFFSET $${values.length}`, values),
        pool.query(`${workItemsCte}
          SELECT kind,urgency,currency,count(*)::int count,COALESCE(sum(amount),0)::numeric amount
          FROM classified ${clause}
          GROUP BY kind,urgency,currency
          ORDER BY kind,urgency,currency`, summaryValues),
      ])
      const byKind = {}
      const byUrgency = Object.fromEntries([...urgencyLevels].map((value) => [value, 0]))
      const exposure = emptyExposure()
      let total = 0
      for (const row of summaryResult.rows) {
        const count = number(row.count)
        const amount = number(row.amount)
        total += count
        byUrgency[row.urgency] = number(byUrgency[row.urgency]) + count
        const current = byKind[row.kind] || { count: 0, amountByCurrency: {} }
        current.count += count
        addCurrencyAmount(current.amountByCurrency, row.currency, amount)
        byKind[row.kind] = current
        if (row.kind === 'receivable') addCurrencyAmount(exposure.receivable, row.currency, amount)
        if (row.kind === 'payable') addCurrencyAmount(exposure.payable, row.currency, amount)
        if (row.kind === 'customer_refund') addCurrencyAmount(exposure.customerRefund, row.currency, amount)
        if (row.kind === 'supplier_refund') addCurrencyAmount(exposure.supplierRefund, row.currency, amount)
      }
      return {
        asOf: asOf.toISOString(),
        items: itemsResult.rows.map(mapWorkItem),
        total,
        page: currentPage,
        pageSize: size,
        summary: { byUrgency, byKind, exposure },
      }
    },
  }
}

export { urgencyLevels, workItemKinds }
