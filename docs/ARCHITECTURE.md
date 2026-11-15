# 初始架构设计

> 设计说明，不代表功能已经实现。先确认 Harness 插件协议，再冻结运行时接口。

## 分层
1. **Harness Adapter**：DeepSeek Harness 首先适配；工具注册、输入输出 schema、生命周期与权限边界。其他平台各自独立 adapter。
2. **Domain Engine**：客户识别、意向/购买力判断、谈判策略、贸易术语与销售阶段。
3. **Local Data Layer**：本地数据库、附件文件、来源/时间/修订审计、客户隔离。
4. **Deterministic Services**：国家/港口检索、报价与利润计算、汇率有效期、提醒与备份恢复。
5. **AI Gateway**：模型选择、上下文裁剪、脱敏、调用量统计；禁止隐式切换云服务。
6. **Optional Integrations**：Skill、ModSearch、ModLens、MinerU、MemSearch，逐个启用、逐项披露数据流。

## 数据边界
- 公开 Git 仓库只放源码、通用文档和合成测试数据。
- 客户数据库、附件、备份、真实报价和密钥只在用户本地。
- 跨用户同步/共享客户记忆不存在。
- 可共享经验必须由用户主动选择发布，且完成不可逆去标识化；默认关闭。

## 建议实体
Customer、ConversationEvent、Evidence、IntentAssessment、PurchasePowerAssessment、VehicleNeed、Destination、PortKnowledge、Quote、QuoteLine、CostEvidence、FollowUpAction、Commitment、AdRecord、SalesOutcome、LearningExample、AuditEvent、BackupManifest。

## 重要工程约束
- 每条事实均携带 source、observed_at、confidence/status。
- 客户原始输入不可被模型改写覆盖；结构化抽取作为派生记录。
- 报价运算使用 Decimal/定点数与明确币种，不使用浮点近似。
- CIF/CIP 风险转移与卖方承担的运输/保险费用分别建模。
- 数据迁移必须可回滚；恢复前先快照当前数据。
