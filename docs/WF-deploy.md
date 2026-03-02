# WF: iClaw 배포 워크플로우

## 개요

`pnpm release` 후 빌드된 `iClaw.app`을 **맥스튜디오(로컬)**와 **맥북(원격)** 두 곳에 배포하는 워크플로우.

## 배포 대상

| 대상 | 호스트 | 경로 | 접속 |
|------|--------|------|------|
| Mac Studio (로컬) | `brucechoe-macstudio` | `~/Applications/iclaw.app` | 로컬 |
| MacBook Pro (원격) | `brucechoes-macbook-pro` | `~/Applications/iclaw.app` | Tailscale SSH |

## 빌드 아티팩트

- **앱 번들**: `apps/desktop/release/mac-arm64/iClaw.app`
- **DMG**: `apps/desktop/release/iClaw-{version}-arm64.dmg`

---

## 빠른 실행

```bash
# 전체 릴리스 + 배포 (권장)
pnpm release patch     # 빌드 완료 후...
pnpm deploy:all        # 양쪽 모두 배포

# 개별 배포
pnpm deploy:local      # Mac Studio만
pnpm deploy:macbook    # MacBook만
```

## 수동 워크플로우 (단계별)

### 1. 릴리스 빌드

```bash
pnpm release [patch|minor|major]
```

이 단계에서:
- 버전 범프 → 커밋 → 빌드 → 패키지(.dmg) → 태그 생성

### 2. 실행 중인 앱 종료

```bash
# 로컬
pkill -x iClaw

# 원격 (맥북)
ssh brucechoes-macbook-pro "pkill -x iClaw"
```

### 3. 로컬 배포 (Mac Studio)

```bash
rm -rf ~/Applications/iclaw.app
cp -R apps/desktop/release/mac-arm64/iClaw.app ~/Applications/iclaw.app
xattr -rd com.apple.quarantine ~/Applications/iclaw.app
```

### 4. 원격 배포 (MacBook)

```bash
ssh brucechoes-macbook-pro "rm -rf ~/Applications/iclaw.app"
rsync -az --delete \
  apps/desktop/release/mac-arm64/iClaw.app/ \
  brucechoes-macbook-pro:~/Applications/iclaw.app/
ssh brucechoes-macbook-pro "xattr -rd com.apple.quarantine ~/Applications/iclaw.app"
```

### 5. 앱 실행 확인

```bash
# 로컬
open ~/Applications/iclaw.app

# 원격
ssh brucechoes-macbook-pro "open ~/Applications/iclaw.app"
```

---

## 스크립트 상세

### `scripts/deploy.sh`

| 인자 | 동작 |
|------|------|
| `local` | Mac Studio에만 배포 |
| `macbook` | MacBook에만 배포 |
| `all` (기본) | 양쪽 모두 배포 |

**동작 순서:**
1. 빌드 아티팩트 존재 확인
2. 대상 머신에서 iClaw 프로세스 종료 (graceful → force kill)
3. 기존 앱 삭제
4. 새 앱 복사/전송 (로컬: `cp -R`, 원격: `rsync`)
5. quarantine 속성 제거
6. 앱 실행

### pnpm 스크립트

```json
{
  "deploy:local": "bash scripts/deploy.sh local",
  "deploy:macbook": "bash scripts/deploy.sh macbook",
  "deploy:all": "bash scripts/deploy.sh all"
}
```

---

## 트러블슈팅

| 문제 | 해결 |
|------|------|
| `Cannot reach brucechoes-macbook-pro` | Tailscale 연결 확인: `tailscale status` |
| `Build artifact not found` | `pnpm release` 먼저 실행 |
| 앱이 열리지 않음 (손상됨) | `xattr -rd com.apple.quarantine ~/Applications/iclaw.app` |
| 원격 앱이 안 죽음 | `ssh brucechoes-macbook-pro "pkill -9 -x iClaw"` |

---

## 전체 릴리스 + 배포 플로우

```
pnpm release patch
    ↓
[1] 버전 범프 → [2] 커밋 → [3] 빌드 → [4] 패키지 → [5] 태그
    ↓
git push && git push --tags
    ↓
pnpm deploy:all
    ↓
[1] 앱 종료 → [2] 로컬 배포 → [3] 원격 배포 → [4] 앱 실행
```
