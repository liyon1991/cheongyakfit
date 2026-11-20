# 청약핏 MVP — Render 배포용

## 포함 기능
- 기존 청약핏 프로필 매칭 데모
- 가상 제휴 매출 시뮬레이터
- 한국부동산원 청약홈 분양정보 API 연결
- 한국부동산원 청약홈 경쟁률 API 연결
- API 인증키는 서버 환경변수로만 사용

## 1) API 활용 신청
공공데이터포털에서 아래 두 API를 각각 활용 신청하세요.
1. https://www.data.go.kr/data/15098547/openapi.do
2. https://www.data.go.kr/data/15098905/openapi.do

개발계정은 무료이며 개발계정 신청은 자동승인으로 안내되어 있습니다. 실제 승인 상태는 로그인 후 마이페이지에서 확인하세요.

## 2) 로컬 실행
Node.js 18 이상이 필요합니다.

```bash
npm install
cp .env.example .env
```

`.env` 파일의 `DATA_GO_KR_SERVICE_KEY`에 공공데이터포털의 일반 인증키를 입력한 뒤:

```bash
npm start
```

브라우저에서 http://localhost:3000 을 여세요.

## 3) GitHub 업로드
압축을 풀고 프로젝트 폴더에서 GitHub 새 저장소를 만든 뒤 파일을 업로드하거나 다음 명령을 실행하세요.

```bash
git init
git add .
git commit -m "Initial CheongyakFit MVP"
git branch -M main
git remote add origin https://github.com/본인계정/저장소명.git
git push -u origin main
```

`.env`는 절대 업로드하지 마세요. `.gitignore`에 포함되어 있습니다.

## 4) Render 배포
1. https://render.com 에 로그인하고 New > Web Service 선택
2. GitHub 저장소 연결
3. Runtime: Node
4. Build Command: `npm ci`
5. Start Command: `npm start`
6. Environment Variables에 아래 항목 추가:
   - Key: `DATA_GO_KR_SERVICE_KEY`
   - Value: 공공데이터포털에서 발급받은 일반 인증키
   - `NODE_VERSION`: `22`
   - Instance Type: Free (무료 인스턴스는 유휴 시 중지될 수 있습니다.)
7. Deploy 클릭

배포가 끝나면 Render가 공개 URL을 제공합니다.

New > Blueprint에서 저장소를 연결하면 `render.yaml`의 설정을 사용할 수도 있습니다. `DATA_GO_KR_SERVICE_KEY`는 Render에서 직접 입력하세요. 저장소에 이 프로젝트 폴더 자체를 올리면 Root Directory는 비워 두고, 상위 폴더를 올리면 `cheongyakfit_render`로 지정하세요.

## 데이터 주의
- 분양정보 API: APT 분양정보 상세조회
- 경쟁률 API: APT 분양정보/경쟁률 조회
- 경쟁률은 접수·은행 전산 상황 등에 따라 최종 청약홈 정보와 차이가 날 수 있습니다.
- 화면의 자격 매칭은 설명용 참고 기능이며 법적·공식 자격 판정이 아닙니다.
- 가상 매출은 시연용 숫자이며 실제 매출이나 제휴가 발생하지 않습니다.
