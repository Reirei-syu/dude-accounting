# Dude Accounting TDD

## 1. 文档目的
本文档描述当前项目的实际技术架构，并给出“账套设置模块”中“会计科目设置”和“辅助账设置”的技术设计方案。这里的 TDD 指 Technical Design Document，不是 Test-Driven Development。

## 2. 当前代码基线

### 2.1 技术栈
- 桌面框架：Electron
- 前端：React 19 + TypeScript
- 构建：electron-vite + Vite
- 状态管理：Zustand
- 样式：Tailwind CSS + 项目自定义玻璃态样式
- UI 组件：Radix UI（已用于 Dialog、Context Menu 等）
- 数据库：SQLite
- SQLite 驱动：better-sqlite3
- 金额计算：decimal.js
- 测试：Vitest

### 2.2 分层结构

#### 主进程
- 位置：`src/main`
- 负责数据库访问、IPC Handler 注册、权限校验

#### 预加载层
- 位置：`src/preload`
- 负责通过 `contextBridge` 暴露 `window.api`

#### 渲染进程
- 位置：`src/renderer/src`
- 负责页面、状态、交互和展示

### 2.3 当前已存在的关键模块
- 认证与会话：`src/main/ipc/auth.ts`、`src/main/ipc/session.ts`
- 账套管理：`src/main/ipc/ledger.ts`
- 科目设置：`src/main/ipc/subject.ts`、`src/renderer/src/pages/SubjectSettings.tsx`
- 辅助账设置草稿：`src/main/ipc/auxiliary.ts`、`src/renderer/src/pages/AuxiliarySettings.tsx`
- 凭证：`src/main/ipc/voucher.ts`
- 系统参数：`src/main/ipc/settings.ts`

## 3. 当前问题

### 3.1 会计科目设置
- `subject:getAll` 仅返回 `subjects` 表字段，不包含辅助项集合
- `subject:create` 允许直接传入类别和余额方向，没有强制从上级科目继承
- `subject:update` 只能改名称、`has_auxiliary`、`is_cash_flow`，不能维护辅助项明细
- 前端页面只有列表和简单新增，不支持查看详情、编辑、辅助项多选

### 3.2 辅助账设置
- `AuxiliarySettings.tsx` 页面存在，但工作区组件映射中未注册
- `registerAuxiliaryHandlers()` 未在 `src/main/index.ts` 中注册
- `window.api` 与 `index.d.ts` 中未暴露 auxiliary API
- 因此辅助账功能当前不构成可用闭环

### 3.3 数据模型
- 现有 `subjects` 表只有 `has_auxiliary` 布尔位，不能表达“一个科目对应多个辅助项类别”
- 现有 `auxiliary_items` 表可存储档案，但科目与辅助类别之间缺少关系表

## 4. 本轮设计目标
- 补齐会计科目设置的完整可用链路
- 补齐辅助账设置的完整可用链路
- 保持企业会计准则账套对一级科目模板的约束
- 尽量减少对已稳定模块的影响

## 5. 设计原则

### 5.1 企业会计准则约束
- `enterprise` 账套继续沿用完整企业会计准则模板
- 企业一级系统科目编码、名称不可修改
- 用户只能新增或维护明细科目

### 5.2 最小侵入
- 不重做现有登录、账套、凭证模块
- 优先在现有表结构基础上增量补表和补 API

### 5.3 主进程集中校验
- 业务规则、权限规则、删除校验都放在主进程
- 渲染进程只负责交互和表单提示

## 6. 数据模型设计

### 6.1 保留现有表

#### `subjects`
保留当前字段：
- `id`
- `ledger_id`
- `code`
- `name`
- `parent_code`
- `category`
- `balance_direction`
- `has_auxiliary`
- `is_cash_flow`
- `level`
- `is_system`

说明：
- `has_auxiliary` 继续作为快速标记字段
- 真正的辅助项配置由新增关系表维护

#### `auxiliary_items`
保留当前字段：
- `id`
- `ledger_id`
- `category`
- `code`
- `name`

### 6.2 新增关系表

#### `subject_auxiliary_categories`
用途：支持一个科目配置多个辅助项类别。

建议结构：

```sql
CREATE TABLE IF NOT EXISTS subject_auxiliary_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  UNIQUE(subject_id, category),
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
);
```

### 6.3 辅助项类别枚举
固定值：
- `customer`
- `supplier`
- `employee`
- `project`
- `department`
- `custom`

## 7. 后端设计

### 7.1 抽取账套设置服务层
建议新增：
- `src/main/services/accountSetup.ts`

职责：
- 校验账套是否存在
- 校验科目是否存在
- 规范化辅助项类别
- 创建科目
- 更新科目
- 查询科目及其辅助项类别
- 创建/修改/删除辅助账

这样可以避免复杂 SQL 和业务规则散落在 IPC 层。

### 7.2 会计科目接口设计

#### `subject:getAll`
输入：
- `ledgerId`

输出：
- 科目基础字段
- `auxiliary_categories: string[]`

说明：
- 前端树形展示和详情面板都依赖该结果

#### `subject:create`
输入建议：

```ts
{
  ledgerId: number
  parentCode: string
  code: string
  name: string
  auxiliaryCategories: string[]
  isCashFlow: boolean
}
```

规则：
- 必须选择上级科目
- 从上级科目继承 `category`、`balance_direction`
- `level = parent.level + 1`
- `is_system = 0`
- `has_auxiliary = auxiliaryCategories.length > 0`

#### `subject:update`
输入建议：

```ts
{
  subjectId: number
  name?: string
  auxiliaryCategories?: string[]
  isCashFlow?: boolean
}
```

规则：
- 系统科目不允许改名称
- 自定义科目允许改名称
- 每次更新辅助项时，先删后插关系表
- 同步更新 `subjects.has_auxiliary`

### 7.3 辅助账接口设计

#### `auxiliary:getAll`
输入：
- `ledgerId`

输出：
- 按 `category, code` 排序的辅助账列表

#### `auxiliary:create`
输入：

```ts
{
  ledgerId: number
  category: string
  code: string
  name: string
}
```

规则：
- 类别必须在允许枚举中
- 同账套同类别下编码唯一

#### `auxiliary:update`
输入：

```ts
{
  id: number
  code?: string
  name?: string
}
```

#### `auxiliary:delete`
规则：
- 若 `voucher_entries.auxiliary_item_id` 已引用，则拒绝删除

## 8. 主进程接线改动

### 8.1 `src/main/index.ts`
需要补充：

```ts
import { registerAuxiliaryHandlers } from './ipc/auxiliary'
```

并在应用启动时注册：

```ts
registerAuxiliaryHandlers()
```

### 8.2 `src/preload/index.ts`
需要新增：
- `api.auxiliary.getAll`
- `api.auxiliary.getByCategory`
- `api.auxiliary.create`
- `api.auxiliary.update`
- `api.auxiliary.delete`

### 8.3 `src/preload/index.d.ts`
需要补充 `AuxiliaryAPI` 类型声明，并将其挂到 `DudeAPI`

## 9. 前端设计

### 9.1 会计科目设置页面
文件：
- `src/renderer/src/pages/SubjectSettings.tsx`

改造目标：
- 左侧展示科目树
- 右侧展示当前选中科目详情
- 顶部提供“新增科目”“编辑科目”
- Dialog 中支持辅助项多选

建议状态：

```ts
type SubjectForm = {
  parentCode: string
  code: string
  name: string
  auxiliaryCategories: string[]
  isCashFlow: boolean
}
```

建议交互：
- 点击系统科目：
  - 可查看
  - 可配置辅助项和现金流量标记
  - 不可编辑名称、编码
- 点击自定义科目：
  - 可编辑名称
  - 可修改辅助项
  - 编码默认不在本轮开放修改，避免级次和引用复杂度

### 9.2 辅助账设置页面
文件：
- `src/renderer/src/pages/AuxiliarySettings.tsx`

当前页面基础结构可复用，主要补齐：
- 页面接入工作区组件映射
- 调通 `window.api.auxiliary`
- 新增/编辑后刷新列表
- 删除失败时显示阻断原因

### 9.3 工作区接线
文件：
- `src/renderer/src/components/Workspace.tsx`

需要补充：

```ts
import AuxiliarySettings from '../pages/AuxiliarySettings'
```

并加入 `componentMap`

## 10. 验证策略

### 10.1 单元测试
建议优先测试服务层，而不是直接测 IPC：
- 新建明细科目必须有上级科目
- 新建科目会继承上级类别和余额方向
- 系统科目不可改名
- 科目辅助项可以增减替换
- 已被凭证使用的辅助账不可删除

### 10.2 集成验证
- 登录管理员账号
- 新建企业账套
- 打开“会计科目设置”
- 为系统科目配置辅助项
- 新建自定义明细科目并配置多个辅助项
- 打开“辅助账设置”
- 新增、修改、删除辅助账

## 11. 风险与处理

### 11.1 风险：科目编码层级不规范
处理：
- 新建时强制选择父科目
- 强制子科目编码以上级编码开头

### 11.2 风险：系统科目被误改
处理：
- 后端按 `is_system` 强校验
- 前端只做禁用展示，不作为唯一防线

### 11.3 风险：辅助项类别与辅助账分类不一致
处理：
- 使用统一枚举值
- 前后端共享相同分类集合

## 12. 本轮交付清单
- 更新后的 `prds/prd.md`
- 更新后的 `prds/TDD.md`
- 账套设置模块后续实现应以本文档为准
