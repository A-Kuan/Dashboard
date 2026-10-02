# EPC 连接器合同

SKU 资料库不直接依赖某一家 EPC 或 VIN 服务。外部服务只负责读取原始目录事实，系统仍通过写入前匹配预览、逐条人工决定和审核流程控制最终入库。

## 服务配置

API 进程支持以下可选环境变量：

- `CATALOG_EPC_CONNECTOR_URL`：完整的采集接口地址；未配置时连接器状态为 `needs_configuration`。
- `CATALOG_EPC_CONNECTOR_TOKEN`：可选 Bearer Token，只保存在服务器环境中，不会返回前端。
- `CATALOG_EPC_CONNECTOR_NAME`：界面显示名称，默认“外部 EPC 连接器”。
- `CATALOG_EPC_CONNECTOR_TIMEOUT_MS`：上游超时毫秒数，默认 15000。

连接器不可用不会关闭手工 EPC 录入。生产环境不得把密钥写入前端构建变量、数据库来源快照或 Git 仓库。

## 请求合同

系统向配置的完整 URL 发送 `POST application/json`：

```json
{
  "schemaVersion": "hushanxing-epc-connector-v1",
  "vin": "WP1ZZZ95ZHLB12345",
  "catalogPath": "95B / 601-05",
  "groupCode": "601-05"
}
```

VIN、目录路径或图组编码至少填写一项。服务可以按自身能力忽略未支持的查询条件，但不得返回未经来源支持的适配结论。

## 响应合同

```json
{
  "schemaVersion": "hushanxing-epc-connector-v1",
  "requestId": "provider-request-id",
  "collectedAt": "2026-10-02T05:00:00.000Z",
  "vin": "WP1ZZZ95ZHLB12345",
  "sourceSystem": "Porsche PET",
  "catalogPath": "95B / 601-05",
  "sourceContext": {
    "vehicleModel": "Macan (95B)"
  },
  "items": [
    {
      "oe": "95B 698 151 H",
      "originalName": "Brake pad set",
      "sourceRecordId": "601-05-01",
      "figurePosition": "位置 1",
      "platformCode": "95B",
      "variantCode": "95B-CYP-CN",
      "vehicleLabel": "Porsche Macan (95B)",
      "yearFrom": 2014,
      "yearTo": 2018,
      "engineCodes": ["CYP"],
      "transmissionCodes": ["A5B03"],
      "prCodes": [],
      "rawPayload": {
        "quantity": 1
      }
    }
  ],
  "assets": [
    {
      "type": "diagram",
      "sourceUrl": "https://provider.example/catalog/601-05.png",
      "sourceRecordId": "601-05-01",
      "figureCode": "601-05",
      "title": "前桥制动器",
      "contentType": "image/png",
      "checksum": "sha256:...",
      "metadata": {}
    }
  ]
}
```

`items` 继续使用现有 EPC 预览校验：一次最多 100 条，OE 和原始名称必填，车型适配仅形成候选。`assets` 一次最多 100 项，只允许 HTTP/HTTPS 来源；系统先保存不可变来源地址、图组、内容类型和上游校验值，再由资料员明确触发托管，不把远程文件冒充为已进入自有存储。

## 错误语义

- `EPC_CONNECTOR_NOT_CONFIGURED`：服务器尚未配置采集地址。
- `EPC_CONNECTOR_UPSTREAM_ERROR`：上游返回非成功状态。
- `EPC_CONNECTOR_UNAVAILABLE`：网络或协议连接失败。
- `EPC_CONNECTOR_TIMEOUT`：超过配置的响应时间。
- `INVALID_EPC_CONNECTOR_RESPONSE`：返回数据不符合版本化合同。

采集成功后仍只创建 `catalog_epc_preview`，不会直接写入或覆盖 SKU。连接器标识、合同版本、请求编号和采集时间进入来源上下文；图组资源进入原始批次载荷并随审计导出保留。

## 运行记录与重试

每次外部采集都会先建立不可删除的运行记录，再调用上游：

- `GET /api/v2/catalog/epc-connector-runs?state=&connectorId=&q=&from=&to=&page=&pageSize=`：按状态、连接器、VIN/目录关键字与日期分页读取运行历史。
- `GET /api/v2/catalog/epc-connector-runs/:id`：读取查询上下文、结果摘要、错误和关联预览。
- `POST /api/v2/catalog/epc-connector-runs/:id/retry`：仅允许重试 `failed` 记录；使用原查询上下文创建新的运行记录。

运行状态为 `running`、`succeeded` 或 `failed`。重试不会覆盖原失败记录，新记录通过 `retryOf` 指回原记录；成功运行保存预览编号、来源系统、目录、零件数和资源数，失败运行只保存安全错误码和文案。运行记录进入 JSON 审计包及其 SHA-256 内容校验。

## 目录资源托管

连接器返回的图组、图片和 PDF 会在 `catalog_epc_asset` 中登记，状态依次为 `pending`、`mirroring`、`stored`；下载失败进入 `failed`，完整性校验失败进入 `corrupt`。每次托管或校验都在 `catalog_epc_asset_attempt` 留下不可覆盖的成功或失败记录。

- `GET /api/v2/catalog/epc-asset-storage`：读取存储是否已配置、大小限制和域名白名单状态，不泄露服务器路径。
- `GET /api/v2/catalog/epc-assets?intakeId=&state=&page=&pageSize=`：分页读取资源与状态汇总。
- `POST /api/v2/catalog/epc-assets/:id/mirror`：由资料员明确触发下载；失败后可重试。
- `POST /api/v2/catalog/epc-assets/:id/verify`：重新计算已托管文件的 SHA-256 和字节数。
- `GET /api/v2/catalog/epc-assets/:id/content`：仅提供已托管文件，使用私有缓存、`nosniff` 和沙箱策略响应。

托管服务只接受 PNG、JPEG、WebP、GIF 和 PDF，以文件魔数而不是扩展名识别类型；同时校验声明类型、可选的上游 SHA-256、最大字节数和下载超时。下载目标禁止本机、内网、链路本地、保留地址和非 80/443 端口，每次重定向都会重新解析并检查；生产环境还应配置来源域名白名单。文件以 SHA-256 内容寻址，相同内容只保存一份，但来源记录和操作记录各自保留。
