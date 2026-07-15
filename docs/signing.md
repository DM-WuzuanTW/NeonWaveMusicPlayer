# 程式碼簽名(Code Signing)設定指南

這裡講的都是**檔案簽名**(安裝檔/執行檔的數位簽章),與上架商店無關。
Release workflow 已內建簽名支援 — **只要把憑證放進 GitHub Secrets 就會自動簽名**,不需要改任何程式或 workflow。

## 先懂一件事:為什麼「免費簽名」沒有用

簽名要能消除系統警告,憑證必須由**作業系統信任的機構**簽發:

- Windows 自簽(self-signed)憑證 → SmartScreen 照樣顯示「未知的發行者」,與未簽名幾乎無異
- macOS 沒有 Developer ID 的簽名 → Gatekeeper 照樣攔

**唯一的免費例外**:macOS 的 **ad-hoc 簽名**(已內建於本專案 `scripts/afterPack.cjs`,自動套用)。
它不能消除警告,但在 Apple Silicon 上能把「App 已損毀,無法打開」硬擋降級為
「無法驗證開發者」→ 使用者右鍵 → 打開即可,不需要終端機指令。

## macOS(必須付費,無免費方案)

1. 加入 [Apple Developer Program](https://developer.apple.com/programs/) — **99 美元/年**
2. 在 Xcode 或 developer.apple.com 建立 **Developer ID Application** 憑證,匯出成 `.p12`(設定密碼)
3. 把 `.p12` 轉成 base64:
   ```bash
   base64 -i certificate.p12 | pbcopy        # macOS
   certutil -encode certificate.p12 out.txt  # Windows
   ```
4. 到 GitHub repo → Settings → Secrets and variables → Actions,新增:

   | Secret | 內容 |
   |--------|------|
   | `MAC_CSC_LINK` | `.p12` 的 base64 字串 |
   | `MAC_CSC_KEY_PASSWORD` | `.p12` 的密碼 |

5. (建議)公證 Notarization — 沒公證的話使用者仍會看到 Gatekeeper 警告:

   | Secret | 內容 |
   |--------|------|
   | `APPLE_ID` | Apple ID 帳號 |
   | `APPLE_APP_SPECIFIC_PASSWORD` | 在 [appleid.apple.com](https://appleid.apple.com/account/manage) 產生的 App 專用密碼 |
   | `APPLE_TEAM_ID` | 開發者帳號的 Team ID |

   設定好後在 `electron-builder.json5` 的 `mac` 區塊加上 `"notarize": true` 即可。

## Windows

三種途徑,擇一:

| 方案 | 費用 | 適合 |
|------|------|------|
| **[SignPath.io](https://signpath.io/open-source)** | **開源專案免費** | 本專案 ✅(需線上申請,審核通過後按其文件整合) |
| OV 程式碼簽名憑證(Sectigo / DigiCert 等) | 約 USD 100–400/年 | 一般;SmartScreen 信譽需累積下載量後才消失 |
| EV 憑證 / Azure Trusted Signing | 較貴 / 約 USD 10/月 | SmartScreen 立即信任 |

拿到 `.pfx` 憑證後(SignPath 除外,它走自己的流程):

1. 轉 base64(同上)
2. 新增 Secrets:

   | Secret | 內容 |
   |--------|------|
   | `WIN_CSC_LINK` | `.pfx` 的 base64 字串 |
   | `WIN_CSC_KEY_PASSWORD` | `.pfx` 的密碼 |

> ⚠️ 2023 年後 CA 規定憑證私鑰必須存在硬體(HSM/USB Token),雲端簽名服務
> (Azure Trusted Signing、SignPath、SSL.com eSigner)通常比買實體 Token 更適合 CI。

## 沒簽名時的行為

- workflow 完全正常,產出未簽名安裝檔(現況)
- Windows:SmartScreen「其他資訊 → 仍要執行」
- macOS:App 右鍵 → 打開,或 `xattr -cr /Applications/NeonWave.app`
