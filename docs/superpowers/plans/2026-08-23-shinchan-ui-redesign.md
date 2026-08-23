# 蜡笔小新全站 UI 重绘 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已确认的蜡笔小新人物、合照和场景规则正式应用到全局布局、工作台及六个功能页面，同时保持现有业务功能和响应式行为。

**Architecture:** 先把官方透明人物图导入项目并建立强类型资产注册表，再用 `CrayonCharacter`、`CrayonCharacterGroup` 和 `CrayonPageIdentity` 统一渲染。页面只声明角色和场景，不让主题组件读取业务数据；现有页面、store、API、Harness 会话和 CRUD 行为保持不变。

**Tech Stack:** Next.js 14、React 18、TypeScript、Tailwind CSS、`next/image`、Vitest、Testing Library、Sharp、Codex in-app Browser。

**Spec:** `docs/superpowers/specs/2026-08-23-shinchan-ui-redesign-design.md`

## Global Constraints

- 不恢复工作台上的快速笔记和最近文档模块，但保留笔记、文档的独立路由、导航、组件、API 和数据。
- 正式页面只引用项目本地素材，不使用远程图片热链。
- 剧情截图只作为构图参考，不进入正式产品 UI。
- 单人物用于页头或状态；合照只用于大空状态、横幅和完成庆祝。
- 搜索、筛选、列表、表单、日历格和设置项不得被人物遮挡。
- 卡片圆角不超过 8px；人物容器必须有固定尺寸。
- 桌面端和移动端都不得出现横向溢出、文字遮挡或布局跳动。
- 不修改待办、日历、笔记、文档、设置和 AI 助手的业务数据流。
- 不修改或提交工作区中与本计划无关的现有改动。
- 正式执行前使用 `superpowers:using-git-worktrees` 从当前 HEAD 创建隔离 worktree，不复制当前工作区未提交的无关文件。

---

## File Structure

### New files

- `public/crayon/characters/*.png`：14 个透明人物素材。
- `public/crayon/characters/SOURCES.md`：素材来源、日期、尺寸和项目文件名。
- `src/components/common/crayon-character.tsx`：人物注册表和单人物渲染。
- `src/components/common/crayon-character-group.tsx`：野原一家与春日部防卫队组合。
- `src/components/common/crayon-page-identity.tsx`：页面页头人物容器。
- `src/tests/crayon-character-assets.test.ts`：素材存在性和透明通道测试。
- `src/tests/crayon-character-components.test.tsx`：共享人物组件测试。
- `src/tests/crayon-shell-identities.test.ts`：顶部栏和侧栏角色测试。
- `src/tests/crayon-page-identities.test.ts`：六个功能页面角色映射测试。
- `docs/superpowers/verification/2026-08-23-shinchan-ui-redesign.md`：最终验收证据。

### Modified files

- `src/components/common/empty-state.tsx`：增加 `visual` 插槽。
- `src/components/common/crayon-decoration.tsx`：只保留合格的透明场景。
- `src/components/layout/topbar.tsx`：透明小新、页面页头装饰插槽。
- `src/components/layout/nav.tsx`：侧栏小新与小白组合。
- `src/components/workspace/overview-cards.tsx`：美伢、风间、广志。
- `src/components/workspace/today-todos.tsx`：防卫队空状态。
- `src/components/workspace/ai-assistant.tsx`：动感超人和玩具场景。
- `src/components/workspace/week-strip.tsx`：野原一家组合。
- `src/app/(app)/todos/page.tsx`：美伢页头和防卫队空状态。
- `src/app/(app)/calendar/page.tsx`：吉永老师、幼儿园场景和小葵空状态。
- `src/app/(app)/notes/page.tsx`：正男页头和阿呆空状态。
- `src/app/(app)/documents/page.tsx`：梦冴页头和探索小新空状态。
- `src/app/(app)/settings/page.tsx`：园长先生页头。
- `src/components/assistant/native-assistant.tsx`：动感超人欢迎状态和肥嘟嘟左卫门错误状态。
- `src/components/harness/harness-embed.tsx`：Harness 加载/错误状态角色。
- `src/app/globals.css`：固定人物容器、组合定位、暗色与响应式样式。
- `src/tests/workspace-home-layout.test.tsx`：工作台人物和合照断言。
- `src/tests/native-assistant.test.tsx`、`src/tests/harness-embed.test.tsx`：助手状态断言。
- `src/tests/crayon-theme.test.ts`：本地素材和旧抠图清理断言。

---

### Task 1: 导入透明人物素材并记录来源

**Files:**
- Create: `public/crayon/characters/shinchan.png`
- Create: `public/crayon/characters/shiro.png`
- Create: `public/crayon/characters/hiroshi.png`
- Create: `public/crayon/characters/misae.png`
- Create: `public/crayon/characters/himawari.png`
- Create: `public/crayon/characters/musae.png`
- Create: `public/crayon/characters/kazama.png`
- Create: `public/crayon/characters/nene.png`
- Create: `public/crayon/characters/masao.png`
- Create: `public/crayon/characters/bo.png`
- Create: `public/crayon/characters/yoshinaga.png`
- Create: `public/crayon/characters/principal.png`
- Create: `public/crayon/characters/action-kamen.png`
- Create: `public/crayon/characters/buriburizaemon.png`
- Create: `public/crayon/characters/SOURCES.md`
- Test: `src/tests/crayon-character-assets.test.ts`

**Interfaces:**
- Produces: stable files under `/crayon/characters/<name>.png` with real alpha channels.
- Produces: exact source metadata consumed by later reviews; no runtime code reads `SOURCES.md`.

- [ ] **Step 1: Write the failing asset test**

```ts
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const characters = [
  "shinchan", "shiro", "hiroshi", "misae", "himawari", "musae",
  "kazama", "nene", "masao", "bo", "yoshinaga", "principal",
  "action-kamen", "buriburizaemon",
] as const;

describe("crayon character assets", () => {
  it.each(characters)("ships a transparent %s PNG", async (name) => {
    const file = path.join(root, "public", "crayon", "characters", `${name}.png`);
    expect(fs.existsSync(file)).toBe(true);
    const metadata = await sharp(file).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.hasAlpha).toBe(true);
    expect(metadata.width).toBeGreaterThanOrEqual(300);
    expect(metadata.height).toBeGreaterThanOrEqual(350);

    const { data, info } = await sharp(file)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number) =>
      data[(y * info.width + x) * info.channels + 3];
    expect([
      alphaAt(0, 0),
      alphaAt(info.width - 1, 0),
      alphaAt(0, info.height - 1),
      alphaAt(info.width - 1, info.height - 1),
    ]).toEqual([0, 0, 0, 0]);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails because assets are absent**

Run: `npm test -- src/tests/crayon-character-assets.test.ts`

Expected: FAIL on `fs.existsSync(file)` for `shinchan.png`.

- [ ] **Step 3: Download the exact official transparent files into the project**

```powershell
$target = "public/crayon/characters"
New-Item -ItemType Directory -Force -Path $target | Out-Null
$assets = @{
  "shinchan.png" = "01.png"
  "hiroshi.png" = "02.png"
  "misae.png" = "03.png"
  "himawari.png" = "04.png"
  "shiro.png" = "05.png"
  "musae.png" = "06.png"
  "yoshinaga.png" = "07.png"
  "principal.png" = "09.png"
  "kazama.png" = "10.png"
  "nene.png" = "11.png"
  "bo.png" = "12.png"
  "masao.png" = "13.png"
  "action-kamen.png" = "24.png"
  "buriburizaemon.png" = "26.png"
}
foreach ($entry in $assets.GetEnumerator()) {
  Invoke-WebRequest -UseBasicParsing `
    "https://www.tv-asahi.co.jp/shinchan/character/img/$($entry.Value)" `
    -OutFile "$target/$($entry.Key)"
}
```

- [ ] **Step 4: Add the complete provenance table**

```markdown
# Character Asset Sources

All files were downloaded on 2026-08-23 from the TV Asahi Crayon Shin-chan character page.

| Project file | Source file | Original size |
| --- | --- | --- |
| shinchan.png | https://www.tv-asahi.co.jp/shinchan/character/img/01.png | 340x420 |
| hiroshi.png | https://www.tv-asahi.co.jp/shinchan/character/img/02.png | 340x500 |
| misae.png | https://www.tv-asahi.co.jp/shinchan/character/img/03.png | 340x500 |
| himawari.png | https://www.tv-asahi.co.jp/shinchan/character/img/04.png | 340x370 |
| shiro.png | https://www.tv-asahi.co.jp/shinchan/character/img/05.png | 340x370 |
| musae.png | https://www.tv-asahi.co.jp/shinchan/character/img/06.png | 340x500 |
| yoshinaga.png | https://www.tv-asahi.co.jp/shinchan/character/img/07.png | 340x500 |
| principal.png | https://www.tv-asahi.co.jp/shinchan/character/img/09.png | 340x500 |
| kazama.png | https://www.tv-asahi.co.jp/shinchan/character/img/10.png | 340x420 |
| nene.png | https://www.tv-asahi.co.jp/shinchan/character/img/11.png | 340x420 |
| bo.png | https://www.tv-asahi.co.jp/shinchan/character/img/12.png | 340x420 |
| masao.png | https://www.tv-asahi.co.jp/shinchan/character/img/13.png | 340x420 |
| action-kamen.png | https://www.tv-asahi.co.jp/shinchan/character/img/24.png | 340x420 |
| buriburizaemon.png | https://www.tv-asahi.co.jp/shinchan/character/img/26.png | 340x420 |
```

- [ ] **Step 5: Run the asset test and verify all files pass**

Run: `npm test -- src/tests/crayon-character-assets.test.ts`

Expected: PASS for 14 assets with four transparent corners each.

- [ ] **Step 6: Commit the asset foundation**

```powershell
git add public/crayon/characters src/tests/crayon-character-assets.test.ts
git commit -m "feat: add transparent crayon characters"
```

---

### Task 2: Build the shared character, group, page identity, and empty-state APIs

**Files:**
- Create: `src/components/common/crayon-character.tsx`
- Create: `src/components/common/crayon-character-group.tsx`
- Create: `src/components/common/crayon-page-identity.tsx`
- Modify: `src/components/common/empty-state.tsx`
- Modify: `src/components/layout/topbar.tsx`
- Test: `src/tests/crayon-character-components.test.tsx`

**Interfaces:**
- Produces: `CrayonCharacterName` union and `CrayonCharacter` component.
- Produces: `CrayonCharacterGroup({ group: "family" | "defense" })`.
- Produces: `CrayonPageIdentity({ character, alt })`.
- Produces: `EmptyStateProps.visual?: React.ReactNode`.
- Produces: `PageHeaderProps.decoration?: React.ReactNode` through the existing `PageHeader` export.

- [ ] **Step 1: Write the failing component tests**

```tsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CrayonCharacter } from "@/components/common/crayon-character";
import { CrayonCharacterGroup } from "@/components/common/crayon-character-group";
import { CrayonPageIdentity } from "@/components/common/crayon-page-identity";
import { EmptyState } from "@/components/common/empty-state";

describe("crayon character components", () => {
  it("renders a meaningful character with stable identity metadata", () => {
    const { container } = render(<CrayonCharacter name="misae" alt="美伢提醒" />);
    expect(screen.getByAltText("美伢提醒")).toBeInTheDocument();
    expect(container.querySelector('[data-crayon-character="misae"]')).toBeTruthy();
  });

  it("renders decorative characters without an accessible name", () => {
    render(<CrayonCharacter name="shiro" decorative />);
    const image = screen.getByRole("presentation");
    expect(image).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the approved defense-team order", () => {
    const { container } = render(<CrayonCharacterGroup group="defense" decorative />);
    expect(
      [...container.querySelectorAll("[data-crayon-character]")].map((node) =>
        node.getAttribute("data-crayon-character"),
      ),
    ).toEqual(["shinchan", "masao", "kazama", "bo", "nene"]);
  });

  it("accepts a visual before empty-state copy", () => {
    render(
      <EmptyState
        visual={<CrayonPageIdentity character="bo" alt="阿呆思考中" />}
        title="还没有笔记"
      />,
    );
    expect(screen.getByAltText("阿呆思考中")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "还没有笔记" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the component test and verify missing-module failures**

Run: `npm test -- src/tests/crayon-character-components.test.tsx`

Expected: FAIL because `crayon-character.tsx`, `crayon-character-group.tsx`, and `crayon-page-identity.tsx` do not exist.

- [ ] **Step 3: Implement the typed character registry and renderer**

```tsx
import Image from "next/image";
import { cn } from "@/lib/utils";

export const CHARACTER_ASSETS = {
  shinchan: { width: 340, height: 420 },
  shiro: { width: 340, height: 370 },
  hiroshi: { width: 340, height: 500 },
  misae: { width: 340, height: 500 },
  himawari: { width: 340, height: 370 },
  musae: { width: 340, height: 500 },
  kazama: { width: 340, height: 420 },
  nene: { width: 340, height: 420 },
  masao: { width: 340, height: 420 },
  bo: { width: 340, height: 420 },
  yoshinaga: { width: 340, height: 500 },
  principal: { width: 340, height: 500 },
  "action-kamen": { width: 340, height: 420 },
  buriburizaemon: { width: 340, height: 420 },
} as const;

export type CrayonCharacterName = keyof typeof CHARACTER_ASSETS;

export function CrayonCharacter({
  name,
  alt,
  decorative = false,
  className,
}: {
  name: CrayonCharacterName;
  alt?: string;
  decorative?: boolean;
  className?: string;
}) {
  const asset = CHARACTER_ASSETS[name];
  return (
    <Image
      src={`/crayon/characters/${name}.png`}
      width={asset.width}
      height={asset.height}
      alt={decorative ? "" : alt ?? name}
      aria-hidden={decorative || undefined}
      draggable={false}
      data-crayon-character={name}
      className={cn("pointer-events-none select-none object-contain", className)}
    />
  );
}
```

- [ ] **Step 4: Implement the approved group order and page identity wrapper**

```tsx
import { cn } from "@/lib/utils";
import {
  CrayonCharacter,
  type CrayonCharacterName,
} from "@/components/common/crayon-character";

const GROUP_MEMBERS = {
  family: ["hiroshi", "misae", "shinchan", "himawari", "shiro"],
  defense: ["shinchan", "masao", "kazama", "bo", "nene"],
} as const satisfies Record<"family" | "defense", readonly CrayonCharacterName[]>;

export type CrayonCharacterGroupName = keyof typeof GROUP_MEMBERS;

export function CrayonCharacterGroup({
  group,
  decorative = false,
  className,
}: {
  group: CrayonCharacterGroupName;
  decorative?: boolean;
  className?: string;
}) {
  return (
    <div data-crayon-group={group} className={cn("crayon-character-group", `crayon-character-group-${group}`, className)}>
      {GROUP_MEMBERS[group].map((name) => (
        <CrayonCharacter key={name} name={name} decorative={decorative} alt={decorative ? undefined : name} />
      ))}
    </div>
  );
}
```

```tsx
import { cn } from "@/lib/utils";
import {
  CrayonCharacter,
  type CrayonCharacterName,
} from "@/components/common/crayon-character";

export function CrayonPageIdentity({
  character,
  alt,
  className,
}: {
  character: CrayonCharacterName;
  alt: string;
  className?: string;
}) {
  return (
    <div data-crayon-page-identity={character} className={cn("crayon-page-identity", className)}>
      <CrayonCharacter name={character} alt={alt} />
    </div>
  );
}
```

- [ ] **Step 5: Add `visual` to `EmptyState` and `decoration` to `PageHeader`**

```tsx
export interface EmptyStateProps {
  visual?: React.ReactNode;
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}
```

Render `{visual ? <div className="crayon-empty-visual">{visual}</div> : null}` before the icon.

Add `decoration?: React.ReactNode` to `PageHeader` and render it in a fixed `crayon-page-header-decoration` container after the title block and before actions.

- [ ] **Step 6: Run the focused tests and typecheck**

Run: `npm test -- src/tests/crayon-character-components.test.tsx`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 7: Commit the shared character system**

```powershell
git add src/components/common/crayon-character.tsx src/components/common/crayon-character-group.tsx src/components/common/crayon-page-identity.tsx src/components/common/empty-state.tsx src/components/layout/topbar.tsx src/tests/crayon-character-components.test.tsx
git commit -m "feat: add reusable crayon character system"
```

---

### Task 3: Replace the global topbar and sidebar cutouts

**Files:**
- Modify: `src/components/layout/topbar.tsx`
- Modify: `src/components/layout/nav.tsx`
- Modify: `src/app/globals.css`
- Test: `src/tests/crayon-shell-identities.test.ts`

**Interfaces:**
- Consumes: `CrayonCharacter` from Task 2.
- Produces: `.crayon-topbar-character`, `.crayon-sidebar-pair`, and fixed-size shell containers.

- [ ] **Step 1: Write the failing shell source test**

```ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("crayon shell identities", () => {
  it("uses the transparent Shin-chan asset in the topbar", () => {
    const source = read("src/components/layout/topbar.tsx");
    expect(source).toContain('name="shinchan"');
    expect(source).not.toContain('scene="head"');
  });

  it("uses separate Shin-chan and Shiro assets in the sidebar", () => {
    const source = read("src/components/layout/nav.tsx");
    expect(source).toContain('name="shinchan"');
    expect(source).toContain('name="shiro"');
    expect(source).not.toContain('scene="sidebar"');
  });
});
```

- [ ] **Step 2: Run the shell test and verify old-scene failures**

Run: `npm test -- src/tests/crayon-shell-identities.test.ts`

Expected: FAIL because TopBar still uses `scene="head"` and Sidebar still uses `scene="sidebar"`.

- [ ] **Step 3: Replace TopBar head art with a transparent peeking character**

```tsx
<span className="crayon-topbar-character hidden xl:block" aria-hidden>
  <CrayonCharacter name="shinchan" decorative />
</span>
```

Use a 48x52 fixed wrapper. Position the 52px-wide transparent character at the top center and hide the feet behind the topbar bottom edge. Do not add a filled badge, white stroke, or opaque background.

- [ ] **Step 4: Replace the sidebar collage with two independent transparent characters**

```tsx
<div className="crayon-sidebar-pair" aria-hidden>
  <CrayonCharacter name="shinchan" decorative className="crayon-sidebar-shinchan" />
  <CrayonCharacter name="shiro" decorative className="crayon-sidebar-shiro" />
</div>
```

Remove the header `scene="head"` cameo and the bottom `scene="sidebar"` image.

- [ ] **Step 5: Add stable responsive shell CSS**

```css
.crayon-topbar-character {
  position: relative;
  width: 48px;
  height: 52px;
  flex: 0 0 48px;
  overflow: hidden;
}

.crayon-topbar-character img {
  position: absolute;
  top: 0;
  left: 50%;
  width: 52px;
  height: auto;
  transform: translateX(-50%);
}

.crayon-sidebar-pair {
  position: relative;
  width: 190px;
  height: 220px;
  flex: 0 0 220px;
  overflow: hidden;
}
```

Add explicit bottom and side positions for `.crayon-sidebar-shinchan` and `.crayon-sidebar-shiro`. At `max-width: 1023px`, reduce the pair to 160x190 without changing nav dimensions.

- [ ] **Step 6: Run focused tests and navigation tests**

Run: `npm test -- src/tests/crayon-shell-identities.test.ts src/tests/navigation-performance.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit the global shell update**

```powershell
git add src/components/layout/topbar.tsx src/components/layout/nav.tsx src/app/globals.css src/tests/crayon-shell-identities.test.ts
git commit -m "feat: replace crayon shell cutouts"
```

---

### Task 4: Apply the approved character roles to the workspace

**Files:**
- Modify: `src/components/workspace/overview-cards.tsx`
- Modify: `src/components/workspace/today-todos.tsx`
- Modify: `src/components/workspace/ai-assistant.tsx`
- Modify: `src/components/workspace/week-strip.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/tests/workspace-home-layout.test.tsx`

**Interfaces:**
- Consumes: `CrayonCharacter`, `CrayonCharacterGroup`.
- Produces: workspace roles `misae`, `kazama`, `hiroshi`, `defense`, `action-kamen`, and `family`.

- [ ] **Step 1: Add failing workspace role assertions**

```tsx
it("uses the approved characters and groups", () => {
  const { container } = render(<WorkspacePage />);
  for (const name of ["misae", "kazama", "hiroshi", "action-kamen"]) {
    expect(container.querySelector(`[data-crayon-character="${name}"]`)).toBeTruthy();
  }
  expect(container.querySelector('[data-crayon-group="defense"]')).toBeTruthy();
  expect(container.querySelector('[data-crayon-group="family"]')).toBeTruthy();
});
```

- [ ] **Step 2: Run the workspace test and verify missing-role failure**

Run: `npm test -- src/tests/workspace-home-layout.test.tsx`

Expected: FAIL because the workspace still uses `CrayonDecoration` scenes.

- [ ] **Step 3: Replace overview-card decoration props with typed names**

Set the three cards to:

```tsx
character="misae"   // 今日待办
character="kazama"  // 日程安排
character="hiroshi" // 专注时间
```

Change `OverviewCard.character` to `CrayonCharacterName` and render `CrayonCharacter` in the existing fixed right-side container.

- [ ] **Step 4: Replace the workspace empty and assistant states**

Use:

```tsx
<CrayonCharacterGroup group="defense" decorative className="workspace-defense-group" />
```

for the no-todos state. Keep the current task list untouched when data exists.

Use:

```tsx
<CrayonCharacter name="action-kamen" decorative className="workspace-assistant-hero" />
```

beside the existing transparent toy strip. Do not add the hero inside the input area.

- [ ] **Step 5: Replace the week-strip school/header art with the family group**

```tsx
<CrayonCharacterGroup group="family" decorative className="workspace-family-group" />
```

Keep day buttons, event counts, today selection, and open-calendar action unchanged.

- [ ] **Step 6: Add fixed workspace group CSS and run tests**

Run: `npm test -- src/tests/workspace-home-layout.test.tsx src/tests/time-hydration.test.tsx`

Expected: PASS with the existing three-card layout and the new character assertions.

- [ ] **Step 7: Commit the workspace redesign**

```powershell
git add src/components/workspace src/app/globals.css src/tests/workspace-home-layout.test.tsx
git commit -m "feat: apply crayon roles to workspace"
```

---

### Task 5: Apply page identities and empty-state visuals to ordinary pages

**Files:**
- Modify: `src/app/(app)/todos/page.tsx`
- Modify: `src/app/(app)/calendar/page.tsx`
- Modify: `src/app/(app)/notes/page.tsx`
- Modify: `src/app/(app)/documents/page.tsx`
- Modify: `src/app/(app)/settings/page.tsx`
- Verify unchanged: `src/app/(app)/notes/[id]/page.tsx`
- Modify: `src/app/globals.css`
- Test: `src/tests/crayon-page-identities.test.ts`

**Interfaces:**
- Consumes: `PageHeader.decoration`, `CrayonPageIdentity`, `CrayonCharacter`, `CrayonCharacterGroup`, `EmptyState.visual`.
- Produces: fixed mappings for todos, calendar, notes, documents, and settings.

- [ ] **Step 1: Write the failing source mapping test**

```ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("crayon page identities", () => {
  it.each([
    ["src/app/(app)/todos/page.tsx", 'character="misae"', 'group="defense"'],
    ["src/app/(app)/calendar/page.tsx", 'character="yoshinaga"', 'name="himawari"'],
    ["src/app/(app)/notes/page.tsx", 'character="masao"', 'name="bo"'],
    ["src/app/(app)/documents/page.tsx", 'character="musae"', 'name="shinchan"'],
    ["src/app/(app)/settings/page.tsx", 'character="principal"', null],
  ] as const)("maps %s to its approved characters", (file, pageIdentity, stateIdentity) => {
    const source = read(file);
    expect(source).toContain(pageIdentity);
    if (stateIdentity) expect(source).toContain(stateIdentity);
  });

  it("keeps the settings identity only in the page header", () => {
    const source = read("src/app/(app)/settings/page.tsx");
    expect(source.match(/character="principal"/g)).toHaveLength(1);
  });

  it("keeps the note editor free of decorative character components", () => {
    const source = read("src/app/(app)/notes/[id]/page.tsx");
    expect(source).not.toContain("CrayonCharacter");
    expect(source).not.toContain("CrayonPageIdentity");
  });
});
```

- [ ] **Step 2: Run the mapping test and verify it fails**

Run: `npm test -- src/tests/crayon-page-identities.test.ts`

Expected: FAIL because none of the pages declares the approved identities.

- [ ] **Step 3: Add identities to all five PageHeader calls**

Use these exact decorations:

```tsx
decoration={<CrayonPageIdentity character="misae" alt="美伢提醒待办" />}
decoration={<CrayonPageIdentity character="yoshinaga" alt="吉永老师查看日历" />}
decoration={<CrayonPageIdentity character="masao" alt="正男记录笔记" />}
decoration={<CrayonPageIdentity character="musae" alt="梦冴整理文档" />}
decoration={<CrayonPageIdentity character="principal" alt="园长先生管理设置" />}
```

- [ ] **Step 4: Add the approved empty-state visuals**

Todos:

```tsx
visual={<CrayonCharacterGroup group="defense" decorative className="crayon-empty-defense" />}
```

Calendar day with no events:

```tsx
<CrayonCharacter name="himawari" decorative className="calendar-empty-himawari" />
```

Notes:

```tsx
visual={<CrayonCharacter name="bo" alt="阿呆思考中" className="crayon-empty-character" />}
```

Documents:

```tsx
visual={<CrayonCharacter name="shinchan" alt="小新探索资料" className="crayon-empty-character" />}
```

Settings has no empty state; do not duplicate the principal inside each setting card. Add a decorative principal only through `PageHeader`.

- [ ] **Step 5: Add the transparent kindergarten strip beside the calendar month title**

Render `CrayonDecoration scene="calendar"` in a fixed 244x70 container outside the month grid. Keep all date cells free of character images.

- [ ] **Step 6: Run page, calendar, and existing business tests**

Run: `npm test -- src/tests/crayon-page-identities.test.ts src/tests/calendar-weekend-styling.test.tsx src/tests/calendar-alignment.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the ordinary page identities**

```powershell
git add src/app/'(app)'/todos/page.tsx src/app/'(app)'/calendar/page.tsx src/app/'(app)'/notes/page.tsx src/app/'(app)'/documents/page.tsx src/app/'(app)'/settings/page.tsx src/app/globals.css src/tests/crayon-page-identities.test.ts
git commit -m "feat: theme productivity pages with crayon characters"
```

---

### Task 6: Theme native and Harness assistant states without changing assistant logic

**Files:**
- Modify: `src/components/assistant/native-assistant.tsx`
- Modify: `src/components/harness/harness-embed.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/tests/native-assistant.test.tsx`
- Modify: `src/tests/harness-embed.test.tsx`

**Interfaces:**
- Consumes: `CrayonCharacter`.
- Produces: Action Kamen for welcome/loading/success context and Buriburizaemon for errors.
- Preserves: RPC payloads, websocket events, iframe URL, retry behavior, cancel behavior, and message rendering.

- [ ] **Step 1: Add failing native-assistant identity assertions**

In the existing empty-conversation test, add:

```tsx
const { container } = render(<NativeAssistant />);
expect(container.querySelector('[data-crayon-character="action-kamen"]')).toBeTruthy();
```

In the existing service-error test, add:

```tsx
expect(container.querySelector('[data-crayon-character="buriburizaemon"]')).toBeTruthy();
```

- [ ] **Step 2: Add failing Harness error-state assertions**

In `harness-embed.test.tsx`, after the failed bootstrap renders:

```tsx
expect(await screen.findByText("无法启动 AI 助手")).toBeInTheDocument();
expect(container.querySelector('[data-crayon-character="buriburizaemon"]')).toBeTruthy();
```

In the loading test, assert `action-kamen` is present beside the existing loading label.

- [ ] **Step 3: Run both assistant tests and verify missing characters**

Run: `npm test -- src/tests/native-assistant.test.tsx src/tests/harness-embed.test.tsx`

Expected: FAIL on the new `data-crayon-character` assertions while all existing assistant behavior assertions still run.

- [ ] **Step 4: Add Action Kamen to the native welcome state**

Replace the black Bot square in the empty-conversation welcome block with:

```tsx
<div className="assistant-welcome-character" aria-hidden>
  <CrayonCharacter name="action-kamen" decorative />
</div>
```

Keep the existing headline, suggestion buttons, message list, composer, action confirmations, and connection indicator unchanged.

- [ ] **Step 5: Add Buriburizaemon to native and Harness error states**

Render a fixed 72x88 decorative Buriburizaemon next to the native error copy and the Harness bootstrap error copy. Keep the text and retry/close actions as the primary accessible controls.

For Harness loading, render a fixed 64x78 Action Kamen above the existing `Loader2`; do not alter the bootstrap request or iframe branch.

- [ ] **Step 6: Run assistant tests and gateway-adjacent tests**

Run: `npm test -- src/tests/native-assistant.test.tsx src/tests/harness-embed.test.tsx src/tests/harness-bootstrap-route.test.ts`

Expected: PASS with unchanged RPC/bootstrap assertions.

- [ ] **Step 7: Commit the assistant state design**

```powershell
git add src/components/assistant/native-assistant.tsx src/components/harness/harness-embed.tsx src/app/globals.css src/tests/native-assistant.test.tsx src/tests/harness-embed.test.tsx
git commit -m "feat: theme assistant states with crayon characters"
```

---

### Task 7: Remove obsolete cutout scenes and harden responsive/dark styling

**Files:**
- Modify: `src/components/common/crayon-decoration.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/tests/crayon-theme.test.ts`

**Interfaces:**
- Consumes: all page migrations from Tasks 3-6.
- Produces: no runtime references to `head`, `sidebar`, `friends`, `standing`, or `shiro` legacy scenes.
- Retains: `assistant` and `calendar` transparent scene strips until later redesign needs require replacement.

- [ ] **Step 1: Add failing legacy-scene assertions**

```ts
it("does not register the rejected rectangular cutout scenes", () => {
  const decoration = readSource("src/components/common/crayon-decoration.tsx");
  for (const rejected of [
    "shinchan-head-clean.png",
    "shinchan-sidebar-clean.png",
    "shinchan-standing-clean.png",
    "shinchan-friends-clean.png",
    "shiro-clean.png",
  ]) {
    expect(decoration).not.toContain(rejected);
  }
});
```

Add a test that scans `src` and asserts no JSX contains `scene="head"`, `scene="sidebar"`, `scene="friends"`, `scene="standing"`, or `scene="shiro"`.

- [ ] **Step 2: Run the theme test and verify legacy references fail**

Run: `npm test -- src/tests/crayon-theme.test.ts`

Expected: FAIL until all obsolete scene keys and assets are removed from the registry and JSX.

- [ ] **Step 3: Remove obsolete entries from `SCENE_ASSETS`**

Keep only scene assets that remain referenced after `rg 'scene="' src` confirms usage. At minimum, retain:

```ts
assistant: { asset: "assistant-toys-clean.png", width: 500, height: 96 },
calendar: { asset: "calendar-school-clean.png", width: 244, height: 70 },
```

- [ ] **Step 4: Add final responsive and dark-theme constraints**

Add media rules so:

- page identities hide or shrink below 480px without reducing title text;
- family and defense groups reduce member width and may hide the outermost secondary member below 420px;
- assistant characters never overlap the composer or retry button;
- sidebar pair remains inside the sidebar at 768-1023px;
- dark mode changes surfaces and neutral shadows only, not character colors.

- [ ] **Step 5: Run theme, type, and focused layout tests**

Run: `npm test -- src/tests/crayon-theme.test.ts src/tests/crayon-character-components.test.tsx src/tests/workspace-home-layout.test.tsx src/tests/crayon-page-identities.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 6: Commit the cleanup and responsive rules**

```powershell
git add src/components/common/crayon-decoration.tsx src/app/globals.css src/tests/crayon-theme.test.ts
git commit -m "fix: remove obsolete crayon cutout scenes"
```

---

### Task 8: Run full automated and browser acceptance, then record evidence

**Files:**
- Create: `docs/superpowers/verification/2026-08-23-shinchan-ui-redesign.md`
- Modify only when verification reveals a concrete defect: files from Tasks 2-7.

**Interfaces:**
- Consumes: completed implementation from Tasks 1-7.
- Produces: explicit automated, desktop, mobile, dark-mode, and business-interaction evidence.

- [ ] **Step 1: Run the full automated verification suite**

Run:

```powershell
npm test
npm run typecheck
$backupRoot = Join-Path (Split-Path (Get-Location) -Parent) ".next-backups"
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
if (Test-Path .next) {
  $backup = Join-Path $backupRoot "ai-work-place-$([DateTimeOffset]::Now.ToUnixTimeSeconds())"
  Move-Item -LiteralPath .next -Destination $backup
}
npm run build
git diff --check
```

Expected: every command exits 0. The clean-cache build must not reuse the active `.next` directory.

- [ ] **Step 2: Start the local preview server without changing production auth**

```powershell
$env:DISABLE_AUTH_FOR_PREVIEW = "true"
npm run dev -- --hostname 127.0.0.1 --port 3010
```

Keep this session running until all browser checks finish.

- [ ] **Step 3: Verify every desktop page at 1440x900**

Open and inspect:

- `http://127.0.0.1:3010/workspace`
- `http://127.0.0.1:3010/todos`
- `http://127.0.0.1:3010/assistant`
- `http://127.0.0.1:3010/calendar`
- `http://127.0.0.1:3010/notes`
- `http://127.0.0.1:3010/documents`
- `http://127.0.0.1:3010/settings`

For each page, verify no opaque rectangular image background, no overlap, no horizontal overflow, and no console error or warning. Capture one screenshot per page.

- [ ] **Step 4: Verify mobile and dark mode**

At 390x844, verify the same seven routes. Confirm page identities shrink or hide, group compositions remain inside their containers, mobile navigation remains usable, and list/form controls retain their full width.

Switch to dark mode and recheck workspace, assistant, calendar, and settings. Confirm character colors remain unchanged and no white sticker outline appears.

- [ ] **Step 5: Verify representative business interactions**

- Create and delete one temporary todo.
- Create and delete one temporary calendar event.
- Create, edit, and delete one temporary note.
- Add and delete one temporary document link.
- Open the native assistant and confirm the composer remains usable.
- Open Harness mode and confirm loading/error/ready states preserve retry and iframe behavior.

Do not claim runtime completion if any interaction cannot be executed; record the exact unverified boundary.

- [ ] **Step 6: Write the verification report from observed evidence**

Create `docs/superpowers/verification/2026-08-23-shinchan-ui-redesign.md` only after Steps 1-5 finish. Include:

- the exact `npm test` file count, test count, and exit status printed by Vitest;
- the exact exit status for typecheck, clean-cache build, and `git diff --check`;
- one row for each of the seven routes, with separately observed desktop, mobile, dark-mode, and console results;
- the observed result of each temporary todo, calendar, note, and document interaction;
- the observed native assistant composer state and Harness loading/error/ready transition;
- an explicit `UNVERIFIED` label beside any check that could not be executed, with the concrete blocking reason.

Do not write expected values into this file. Record only outputs and browser states observed during the execution turn.

- [ ] **Step 7: Commit verification evidence**

```powershell
git add docs/superpowers/verification/2026-08-23-shinchan-ui-redesign.md
git commit -m "docs: record shinchan UI verification"
```

---

## Final Review Checklist

- [ ] Every spec page maps to one implementation task.
- [ ] No task deletes notes/documents routes or restores hidden homepage modules.
- [ ] No final UI references remote image URLs or story screenshots.
- [ ] Topbar no longer references `shinchan-head-clean.png`.
- [ ] Every group uses typed transparent member assets.
- [ ] Assistant tests still prove RPC/bootstrap behavior.
- [ ] Full tests, typecheck, clean build, diff check, browser QA, and representative interactions are recorded separately.
