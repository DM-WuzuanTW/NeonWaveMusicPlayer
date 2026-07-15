# 程式碼簽名(Code Signing)設定指南

目前 Release 產出的是**未簽名**版本:Windows 會跳 SmartScreen 警告、macOS 需要右鍵開啟。
Release workflow 已內建簽名支援 — **只要把憑證放進 GitHub Secrets 就會自動簽名**,不需要改任何程式或 workflow。

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
