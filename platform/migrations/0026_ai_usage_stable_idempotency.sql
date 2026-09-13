-- V1 审核 #5：AI 计费幂等键稳定化。
-- 旧格式 action_type = 'ai.classify.<band>.<provider>' 把运行时重新计算的
-- 档位/供应商编进幂等键：余额变化导致降档时，同一逻辑操作（同一主体 +
-- attempt）会生成另一条计费键 → 重复扣费。从本迁移起 action_type 只保留
-- 稳定前缀（'ai' / 'ai.classify' / 'ai.insight'），档位落到新列
-- model_band（供应商沿用 supplier 列），幂等索引无需重建。
-- 历史行回填 model_band 便于审计；reserveAiRun 的回放查询对旧格式
-- 按前缀 LIKE 匹配，部署边界上的在途任务不会重复扣费。

ALTER TABLE task_event ADD COLUMN model_band text;

UPDATE task_event
   SET model_band = (regexp_match(action_type, '\.(eco|standard|flagship)\.(primary|fallback)$'))[1]
 WHERE model_band IS NULL
   AND action_type ~ '^ai(\.[a-z_]+)?\.(eco|standard|flagship)\.(primary|fallback)$';
