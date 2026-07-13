# CNT — Font Changer

CNT는 Chrome 기반 브라우저에서 사이트별로 폰트, 글자 크기와 굵기를 적용하는 Manifest V3 확장 프로그램입니다.

## 주요 기능

- Pretendard Variable, Mona12, 나눔명조 로컬 폰트 제공
- 사이트별 ON/OFF 및 정확한 호스트 예외 규칙
- `*.example.com` 형식의 하위 도메인 규칙
- 전체 기본 스타일과 사이트별 개별 오버라이드
- 동적으로 추가되는 텍스트 감지
- 열린 Shadow DOM과 iframe 내부 적용
- 아이콘 폰트, 코드 블록, 접근성 전용 텍스트 보호
- 기존 2.x 설정 자동 마이그레이션
- 페이지 텍스트를 수집하거나 전송하지 않는 로컬 처리

## 설치

1. 이 저장소를 다운로드합니다.
2. Chrome에서 `chrome://extensions`를 엽니다.
3. 우측 상단의 **개발자 모드**를 켭니다.
4. **압축해제된 확장 프로그램을 로드합니다**를 누릅니다.
5. 저장소 폴더를 선택합니다.

## 사이트 규칙

- `example.com`: 해당 호스트에만 적용합니다.
- `*.example.com`: 루트 도메인과 모든 하위 도메인에 적용합니다.
- 더 구체적인 규칙이 우선합니다.
- 정확한 호스트 규칙은 상위 도메인 프리셋보다 우선합니다.

예를 들어 `roblox.com` 프리셋이 켜져 있어도 `www.roblox.com`에 정확한 OFF 규칙을 만들면 해당 호스트에서만 적용이 중단됩니다.

## 구조

- `shared.js`: 설정 스키마, 마이그레이션, 도메인 매칭, 굵기 보정
- `background.js`: 설정 저장·캐시·탭 동기화·iframe 최상위 호스트 전달
- `content.js`: 텍스트 감지와 폰트 적용 엔진
- `popup.js`: 설정 UI와 실시간 미리보기
- `popup.css`: 팝업 UI 스타일
- `tests/shared.test.js`: 핵심 설정 로직 단위 테스트

## 검증

Node.js 20 이상에서 다음 명령을 실행합니다.

```bash
npm run verify
```

이 명령은 JavaScript 문법, `manifest.json`, 도메인 규칙, 설정 마이그레이션과 굵기 보정 테스트를 검사합니다.

## 개인정보 보호

CNT는 페이지 텍스트를 수집하거나 외부 서버로 전송하지 않습니다. 설정은 Chrome의 `storage.sync`에 저장되고 빠른 초기 적용을 위해 `storage.local`에 동일한 캐시를 유지합니다.
