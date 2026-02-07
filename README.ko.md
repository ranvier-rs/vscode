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

### 2) 회로 스키매틱 생성

워크스페이스 루트(또는 CLI manifest 기준)에서:

```bash
cargo run --manifest-path cli/Cargo.toml -- schematic basic-schematic --output schematic.json
```

확장은 기본적으로 아래 파일을 읽습니다:

1. `<workspace-root>/schematic.json`
2. `<workspace-root>/diagnostics.json` (선택)

### 3) VSCode에서 사용

1. Command Palette -> `Ranvier: Open Circuit View`
2. Ranvier 사이드바에서 `Ranvier Circuit Nodes` 패널 확인
3. 노드 클릭 또는 패널 선택으로 소스 점프
4. `Run Schematic Export`로 `schematic.json` 갱신
5. `Refresh Diagnostics`로 진단 오버레이 갱신
6. 필요 시 `Ranvier: Refresh Circuit Data`로 수동 새로고침
7. Problems 패널에서 파일 단위 진단(`source: ranvier:*`) 확인
8. `Ranvier: 현재 줄에서 회로 노드 찾기`로 에디터 라인 기준 회로 포커스

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

1. `Ranvier: Open Circuit View`
2. `Ranvier: Refresh Circuit Data`
3. `Ranvier: Run Schematic Export`
4. `Ranvier: Reveal Node Source`
5. `Ranvier: Refresh Diagnostics`
6. `Ranvier: 현재 줄에서 회로 노드 찾기`

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
