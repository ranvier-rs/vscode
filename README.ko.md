# Ranvier Dev Assist

[English README](./README.md)

Ranvier Dev Assist는 Ranvier 프로젝트를 위한 개발 보조 확장입니다.
회로 시각화, 실시간 서버 모니터링, 인터랙티브 디버깅,
코드 수준 인텔리전스를 VS Code 안에서 제공합니다.

- Publisher: `cellaxon`
- Extension ID: `cellaxon.ranvier-vscode`
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=cellaxon.ranvier-vscode) · [Open VSX](https://open-vsx.org/extension/cellaxon/ranvier-vscode)
- Repository: [github.com/ranvier-rs/vscode](https://github.com/ranvier-rs/vscode)

## 기능

### 회로 시각화

- SvelteFlow(`@xyflow/svelte`) 기반 인터랙티브 플로우 그래프
- 팬, 줌, 미니맵, 드래그로 노드 재배치
- 노드 위치가 Rust 소스에 자동 저장 (`#[transition(x, y)]`)
- 현재 편집 중인 파일에 매핑된 노드 하이라이트

### 소스 내비게이션

- **노드 → 소스**: 노드를 클릭하면 `source_location`의 파일과 줄로 점프
- **소스 → 노드**: `현재 줄에서 회로 노드 찾기`로 가장 가까운 노드에 포커스
- **이슈 순회**: `다음/이전 노드 이슈로 이동` 단축키로 진단이 있는 노드를 순회

### 진단

- `diagnostics.json`을 읽어 노드에 심각도 배지(error / warning / info) 오버레이
- 매핑된 진단을 VS Code **Problems** 패널에 파일 단위로 투영
- 사이드바에서 노드별 요약과 호버 툴팁 표시

### 실시간 서버 모니터링

Ranvier Inspector 서버에 WebSocket으로 연결하여 라이브 메트릭을 표시합니다.

- **4모드 히트맵 오버레이**:
  - **Traffic** — 초당 처리량 (green → yellow → red)
  - **Latency** — p95 응답 시간 (ms)
  - **Errors** — 에러율 (%)
  - **None** — 비활성 (기본값)
- **노드 배지**: 메트릭 값 표시 (예: `25/s`, `p95:450ms`, `15%err`)
- **엣지 스타일링**: 처리량과 에러율에 따라 동적 변경
- 서버 URL(`ranvier.debugger.inspectorUrl`) 및 폴링 간격(`ranvier.server.pollInterval`) 설정 가능

### 이벤트 스트림 패널

Inspector의 실시간 이벤트 로그와 필터링 기능을 제공합니다.

- `node_enter`, `node_exit`, `circuit_exit` 이벤트 캡처 (최대 200건)
- 노드 ID, 이벤트 타입, 자유 텍스트로 필터링
- 이벤트 타입별 색상 구분 및 장애(fault) 강조
- 타임스탬프 표시 (HH:MM:SS.mmm)

### 정체(Stall) 감지

- Inspector가 설정 가능한 시간 임계값(기본 30초)을 초과하는 노드를 감지
- 정체된 노드에 **펄싱 빨간 글로우** 및 `[STALL]` 배지 표시
- 서버 측 설정: `RANVIER_INSPECTOR_STALL_THRESHOLD_MS`

### 디버그 컨트롤

중단점에서 일시 중지된 실행을 위한 인터랙티브 디버깅.

- 실행이 중단점에서 일시 중지되면 툴바에 **Resume** / **Step** 버튼 표시
- 상태 바에 일시 중지된 노드와 trace ID 표시
- 일시 중지된 노드가 회로에서 시각적으로 강조

### 템플릿 툴박스

카테고리별로 정리된 코드 스니펫 사이드바 패널.

- **클릭**: 커서 위치에 스니펫 삽입
- **드래그**: 캔버스에 드롭하여 새 트랜지션 노드 추가
- 카테고리: Transitions, Pipelines, Bus & Resources, Error Handling, Resilience
- 내장 학습 경로: Quick Start, HTTP Services, Advanced Patterns

### 코드 인텔리전스 (Rust)

- **자동 완성**: Axon 메서드 제안 (`.then()`, `.retry()`, `.checkpoint()`, …) 및 스키매틱의 트랜지션 이름
- **호버**: 노드 메타데이터, 소스 위치, 진단 요약을 호버로 표시

### 프로젝트 탐지

- 모노레포에서 Ranvier 프로젝트 자동 탐지 (`Cargo.toml` / `package.json` 스캔)
- 워크스페이스별 프로젝트 타겟 선택 및 캐시
- 사이드바 드롭다운으로 프로젝트 전환

## 빠른 데모

노드 클릭 → 소스 점프:

![Node click to source jump demo](./media/demo-node-jump.gif)

## 설정 방법

### 1) Ranvier 의존성 추가

```bash
cargo add ranvier
cargo add tokio --features full
cargo add anyhow
```

### 2) Ranvier CLI 설치 및 스키매틱 생성

```bash
cargo install ranvier-cli
ranvier schematic basic-schematic --output schematic.json
```

확장은 기본적으로 아래 파일을 읽습니다:

1. `<workspace-root>/schematic.json`
2. `<workspace-root>/diagnostics.json` (선택)

### 3) VS Code에서 사용

1. Command Palette → `Ranvier: 회로 뷰 열기`
2. **Ranvier 회로 노드** 사이드바 패널 열기
3. 노드 클릭으로 소스 점프
4. `Schematic Export 실행`으로 `schematic.json` 재생성
5. `진단 새로고침`으로 진단 오버레이 갱신
6. 툴바의 **Heatmap** 버튼으로 모니터링 모드 전환

### 4) Inspector 서버 연결 (선택)

Ranvier Inspector 서버를 시작하면 확장이 자동으로 연결합니다:

- 기본 URL: `http://localhost:3000` (`ranvier.debugger.inspectorUrl`로 설정 가능)
- 메트릭, 이벤트, 정체 알림, 디버그 컨트롤이 자동 활성화
- 서버가 실행 중이지 않으면 정적 `schematic.json`으로 폴백

## 명령 목록

| 명령 | ID | 단축키 |
|---|---|---|
| 회로 뷰 열기 | `ranvier.openCircuitView` | |
| 회로 데이터 새로고침 | `ranvier.refreshCircuitData` | |
| Schematic Export 실행 | `ranvier.exportSchematic` | |
| 노드 소스 열기 | `ranvier.revealNodeSource` | |
| 진단 새로고침 | `ranvier.refreshDiagnostics` | |
| 현재 줄에서 회로 노드 찾기 | `ranvier.revealNodeFromCurrentLine` | |
| 다음 노드 이슈로 이동 | `ranvier.nextNodeIssue` | `Ctrl+Alt+N` |
| 이전 노드 이슈로 이동 | `ranvier.previousNodeIssue` | `Ctrl+Alt+P` |

macOS: `Cmd+Alt+N` / `Cmd+Alt+P`

## 설정

| 키 | 기본값 | 설명 |
|---|---|---|
| `ranvier.schematicExport.example` | `basic-schematic` | CLI 스키매틱 내보내기 예제 이름 |
| `ranvier.schematicExport.outputPath` | `schematic.json` | 내보낸 스키매틱 출력 경로 |
| `ranvier.diagnostics.inputPath` | `diagnostics.json` | 진단 입력 파일 경로 |
| `ranvier.debugger.inspectorUrl` | `http://localhost:3000` | Inspector 서버 URL |
| `ranvier.server.pollInterval` | `10` | 서버 헬스 체크 폴링 간격 (초, 2–300) |

## 진단 입력 형식

예시 `diagnostics.json`:

```json
{
  "diagnostics": [
    {
      "node_id": "inspect",
      "severity": "error",
      "message": "Inspector path timeout",
      "source": "runtime"
    }
  ]
}
```

필수 필드: `node_id` (또는 `nodeId`), `severity`, `message`, `source`

## 입력 호환 규칙

지원 source mapping 필드:

- `source_location` / `sourceLocation`
- `metadata.source_location` / `metadata.sourceLocation`

지원 edge endpoint 필드:

- `source` / `target`
- `from` / `to`

## 단축키 충돌 FAQ

**Q: `Ctrl+Alt+N/P`가 동작하지 않습니다.**
A: VSCode 키보드 단축키에서 충돌 항목을 확인한 뒤 `keybindings.json`에서 재정의하세요.

**Q: Vim 확장이 먼저 단축키를 가져갑니다.**
A: `Ctrl+Shift+Alt+N/P`로 변경하고 `when: "editorTextFocus && !editorReadonly"` 조건을 유지하세요.

**Q: JetBrains 키맵과 충돌합니다.**
A: 충돌 없는 조합으로 Ranvier 명령을 재매핑하세요.

**Q: macOS 글로벌 단축키와 충돌합니다.**
A: `Cmd+Shift+Alt+N/P`로 `keybindings.json`에서 재지정하세요.

프로필 템플릿: `keybindings.recommended.json`, `keybindings.vim.json`, `keybindings.jetbrains.json`, `keybindings.mac.json`

## 배포 / 운영 가이드

전체 문서: [`docs/03_guides/vscode_extension_deploy.md`](../docs/03_guides/vscode_extension_deploy.md)

| # | 섹션 | 용도 |
|---|------|------|
| 2 | [Local Build Checks](../docs/03_guides/vscode_extension_deploy.md#2-local-build-checks) | publish 전 빌드/타입체크/패키징 검증 |
| 8 | [Keyboard Shortcuts (Team Override)](../docs/03_guides/vscode_extension_deploy.md#8-keyboard-shortcuts-team-override) | 단축키 충돌 시 팀 기준 재정의 |
| 10 | [Conflict Matrix](../docs/03_guides/vscode_extension_deploy.md#10-conflict-matrix-quick-reference) | Vim/JetBrains/macOS 충돌 빠른 조회 |
| 14 | [Release Checklist Template](../docs/03_guides/vscode_extension_deploy.md#14-release-checklist-template) | 릴리즈 단계별 체크리스트 |
