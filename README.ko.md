# Ranvier Dev Assist

[English README](./README.md)

Ranvier Dev Assist는 **Ranvier 프로젝트 개발 시 필수에 가까운 보조 확장**입니다.  
목표는 실행 전 단계에서 회로 구조를 빠르게 검증하고, 노드-코드 매핑을 통해 변경 영향을 줄이는 것입니다.

- Publisher: `cellaxon`
- Extension ID: `cellaxon.ranvier-vscode`
- Marketplace: `https://marketplace.visualstudio.com/manage/publishers/cellaxon`

## 이 확장의 용도

1. `schematic.json` 기반 회로 시각화
2. 노드 클릭/선택 -> 소스 점프(`source_location`)
3. 현재 열려 있는 파일과 매핑되는 노드 하이라이트
4. 사이드바 패널(`Ranvier Circuit Nodes`)에서 구조 탐색
5. 확장 내부 버튼으로 `Run Schematic Export` 즉시 실행
6. `diagnostics.json` 기반 노드 단위 진단 오버레이(웹뷰/사이드바)
7. 소스 매핑된 노드 진단을 VSCode Problems 패널에 파일 단위로 투영

## 빠른 데모

노드 클릭 -> 소스 점프 흐름:

![Node click to source jump demo](./media/demo-node-jump.gif)

## Ranvier 프로젝트에 설정하는 방법

### 1) Ranvier 의존성 추가

```bash
cargo add ranvier
cargo add tokio --features full
cargo add anyhow
```

### 2) Ranvier CLI 설치 및 회로 스키매틱 생성

먼저 Ranvier CLI를 한 번 설치하세요:

```bash
cargo install ranvier-cli
```

그 다음 워크스페이스 루트에서 실행하세요:

```bash
ranvier schematic basic-schematic --output schematic.json
```

확장은 기본적으로 아래 파일을 읽습니다:

1. `<workspace-root>/schematic.json`
2. `<workspace-root>/diagnostics.json` (선택)

### 3) VSCode에서 사용

1. Command Palette -> `Ranvier: 회로 뷰 열기` (`Ranvier: Open Circuit View`)
2. Ranvier 사이드바에서 `Ranvier 회로 노드` 패널 확인
3. 노드 클릭 또는 패널 선택으로 소스 점프
4. `Ranvier: Schematic Export 실행`으로 `schematic.json` 갱신
5. `Ranvier: 진단 새로고침`으로 진단 오버레이 갱신
6. 필요 시 `Ranvier: 회로 데이터 새로고침`으로 수동 새로고침
7. Problems 패널에서 파일 단위 진단(`source: ranvier:*`) 확인
8. `Ranvier: 현재 줄에서 회로 노드 찾기`로 에디터 라인 기준 회로 포커스
9. `Ranvier: 다음 노드 이슈로 이동` / `Ranvier: 이전 노드 이슈로 이동`으로 이슈 순회
10. 기본 단축키: `Ctrl+Alt+N` / `Ctrl+Alt+P` (macOS: `Cmd+Alt+N` / `Cmd+Alt+P`)
11. 단축키 충돌 시 VSCode `keybindings.json`에서 팀 규칙으로 재정의할 수 있습니다(배포 가이드 `Keyboard Shortcuts (Team Override)` 참고).
12. 팀 템플릿 파일: `vscode/.vscode/keybindings.recommended.json` (각자 user `keybindings.json`으로 복사해 적용).
13. 선택 프로필 템플릿: `keybindings.vim.json`, `keybindings.jetbrains.json`, `keybindings.mac.json`.

### 4) Diagnostics 입력 형식(선택)

예시 `diagnostics.json`:

```json
{
  "diagnostics": [
    {
      "node_id": "inspect",
      "severity": "error",
      "message": "Inspector path timeout",
      "source": "runtime"
    },
    {
      "node_id": "ingress",
      "severity": "warning",
      "message": "Slow branch selected",
      "source": "lint"
    }
  ]
}
```

필수 필드:

1. `node_id` (또는 `nodeId`)
2. `severity` (`error`, `warning`, `info`)
3. `message`
4. `source`

설정 키:

1. `ranvier.diagnostics.inputPath` (기본값: `diagnostics.json`)

## 팀 협업 권장 루프 (PR 전)

1. Ranvier 구조 변경이 있으면 `schematic.json`을 재생성한다
2. 회로 뷰에서 노드/엣지 변화가 의도와 일치하는지 점검한다
3. 변경된 핵심 노드에서 소스 점프가 정상 동작하는지 확인한다
4. 활성 파일 하이라이트가 기대 노드와 맞는지 확인한다
5. 필요하면 PR 설명에 `schematic` 관점 영향 범위를 기록한다

## 명령 목록

1. `Ranvier: 회로 뷰 열기` (`ranvier.openCircuitView`)
2. `Ranvier: 회로 데이터 새로고침` (`ranvier.refreshCircuitData`)
3. `Ranvier: Schematic Export 실행` (`ranvier.exportSchematic`)
4. `Ranvier: 노드 소스 열기` (`ranvier.revealNodeSource`)
5. `Ranvier: 진단 새로고침` (`ranvier.refreshDiagnostics`)
6. `Ranvier: 현재 줄에서 회로 노드 찾기` (`ranvier.revealNodeFromCurrentLine`)
7. `Ranvier: 다음 노드 이슈로 이동` (`ranvier.nextNodeIssue`)
8. `Ranvier: 이전 노드 이슈로 이동` (`ranvier.previousNodeIssue`)

## 단축키 충돌 FAQ

### 일반 충돌

1. Q: `Ctrl+Alt+N/P`가 동작하지 않습니다.
A: VSCode 키보드 단축키에서 충돌 항목을 확인한 뒤, 배포 가이드의 팀 override 예시로 `keybindings.json`을 재정의하세요.

### Vim 충돌

2. Q: Vim 확장이 먼저 단축키를 가져갑니다.
A: `Ctrl+Shift+Alt+N/P` 같은 다른 조합으로 변경하고 `when: "editorTextFocus && !editorReadonly"` 조건을 유지하세요.

### JetBrains 키맵 충돌

3. Q: JetBrains 키맵 확장과 충돌합니다.
A: 충돌 없는 조합으로 Ranvier 명령을 재매핑하고, 팀 표준 단축키를 문서로 고정하세요.

### macOS 글로벌 단축키 충돌

4. Q: macOS 글로벌 단축키와 `Cmd+Alt+N/P`가 충돌합니다.
A: VSCode `keybindings.json`에서 `Cmd+Shift+Alt+N/P` 등 다른 조합으로 재지정하세요.

## 입력 데이터 호환 규칙

지원 source mapping 필드:

1. `source_location`
2. `sourceLocation`
3. `metadata.source_location`
4. `metadata.sourceLocation`

지원 edge endpoint 필드:

1. `source` / `target`
2. `from` / `to`

## 참고

1. `docs/03_guides/vscode_extension_deploy.md`
