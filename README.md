# Ranvier Dev Assist

Ranvier Dev Assist는 **Ranvier 프로젝트 개발 시 필수에 가까운 보조 확장**입니다.  
목표는 실행 전 단계에서 회로 구조를 빠르게 검증하고, 노드-코드 매핑을 통해 변경 영향을 줄이는 것입니다.

- Publisher: `cellaxon`
- Extension ID: `cellaxon.ranvier-vscode`
- Marketplace: `https://marketplace.visualstudio.com/manage/publishers/cellaxon`

## 이 확장의 용도

1. `schematic.json` 기반 회로 시각화
2. 노드 클릭/선택 -> 소스 점프(`source_location`)
3. 현재 열려 있는 파일과 매핑되는 노드 하이라이트
4. Explorer 패널(`Ranvier Circuit Nodes`)에서 구조 탐색
5. 확장 내부 버튼으로 `Run Ranvier Schematic Export` 즉시 실행
6. `diagnostics.json` 기반 노드 단위 진단 오버레이(웹뷰/Explorer)

## 빠른 데모

노드 클릭 -> 소스 점프 흐름(데모 GIF):

![Node click to source jump demo](./media/demo-node-jump.gif)

## Ranvier 프로젝트에 설정하는 방법

### 1) Ranvier 의존성 추가

출판 크레이트 기준 최소 시작:

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
2. Explorer -> `Ranvier Circuit Nodes` 패널 확인
3. 노드 클릭 또는 패널 선택으로 소스 점프
4. 웹뷰 상단 버튼 `Run Schematic Export`로 `schematic.json` 갱신
5. 웹뷰 상단 버튼 `Refresh Diagnostics`로 진단 오버레이 갱신
6. 필요 시 `Ranvier: Refresh Circuit Data`로 수동 새로고침

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

## 웹 애플리케이션 개발에서 활용 방법

예: Ranvier 기반 백엔드 + 웹 프론트엔드를 함께 개발할 때

1. 백엔드 Axon/Transition 변경
2. `schematic.json` 재생성
3. 확장에서 변경된 노드/엣지 흐름 확인
4. 영향 노드 클릭으로 바로 소스 점프
5. 현재 수정 중인 파일과 연결된 노드 하이라이트로 영향 범위 빠르게 확인

권장 루프:

1. 코드 변경
2. schematic 재생성
3. 회로 뷰 점검
4. 브랜치/경로 이상 여부 확인
5. 테스트/실행

## 명령 목록

1. `Ranvier: Open Circuit View`
2. `Ranvier: Refresh Circuit Data`
3. `Ranvier: Run Schematic Export`
4. `Ranvier: Reveal Node Source`
5. `Ranvier: Refresh Diagnostics`

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

배포/운영 절차는 아래 문서를 참고:

1. `docs/03_guides/vscode_extension_deploy.md`

## 팀 협업 체크리스트 (PR 전)

1. Ranvier 구조 변경이 있으면 `schematic.json`을 재생성한다.
2. 확장에서 회로 뷰를 열고 노드/엣지 변화가 의도와 일치하는지 점검한다.
3. 변경된 핵심 노드에서 소스 점프가 정상 동작하는지 확인한다.
4. 활성 파일 하이라이트가 기대 노드와 맞는지 확인한다.
5. 이상이 있으면 PR 설명에 `schematic` 관점 영향 범위를 기록한다.
