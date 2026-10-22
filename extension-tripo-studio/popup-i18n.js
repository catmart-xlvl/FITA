export const messages = {
  en: {
    permissionsTitle:"Permissions and your data",permissionsBody:"Access: Tripo Studio and 127.0.0.1 only. Downloads: identify requested exports. Content settings: allow multiple downloads only for Studio, cleared on disconnect. Session storage: pairing. Local storage: language and export receipts. Alarms: reconnect the local bridge.",
    saveDiagnostic:"Save layout diagnostic",diagnosticSaved:"Saved to Downloads/FITA/studio-layout-diagnostic.json. No upload or generation was performed.",
    diagnostics:"Inspect uploaded views",diagnosticHint:"Read-only report of upload slots, file hashes and visible controls. Does not upload or generate.",
    brand: "FITA", heading: "Connect Tripo Studio", intro: "Connect the tab you select. Read-only by default; project commands require your explicit consent.",
    automationConsent:"Allow explicit project commands on this tab",
    automationHint:"Optional: send approved views, confirm the displayed cost in FITA before Generate, and export the task you confirm. Never submits automatically.",
    automationReady:"Project commands authorized for this tab. Sending images and generating still require separate confirmation in FITA.",
    step1: "1. Copy this ID into FITA settings", open: "Open Tripo Studio", openHint: "Opening the page does not connect or verify your account.",
    step2: "2. Enter the code shown in FITA", pair: "Pair", codeHint: "8 digits", step3: "3. Authorize one tab for read-only access", connect: "Connect selected tab",
    privacy: "Shares tab state with local FITA. Authorized commands check references, options and cost, copy confirmed candidate thumbnails and transfer requested GLB exports. Does not read passwords or cookies.",
    refresh: "Refresh status", disconnect: "Revoke connection", limit: "Independent integration; not an official Tripo extension. Your session stays in your browser. Revoke access at any time.",
    checking: "Checking…", noTabs: "Open Tripo Studio first", readable: "Connected for read-only inspection. Project commands are not authorized.",
    paired: "Paired. Select and authorize a tab.", offline: "Not connected. Pair with FITA running at 127.0.0.1:4317.",
    genericError: "The connection could not be completed. Check that FITA is running, refresh your pairing code and select a Studio tab.",
    tabMissing: "The selected tab is no longer in Tripo Studio. Select it again.", noAccess: "The page did not confirm read access. Wait for it to finish loading.",
    unavailableTab: "The tab is not available for reading. Open this panel and connect it again.", backendOffline: "Could not reach local FITA. Make sure it is running.",
    localDisconnect: "Disconnected here. FITA was unreachable; revoke there too or wait for its session to expire.", revoked: "Connection revoked.",
    invalidCode: "Enter the temporary eight-digit code from FITA.", pairFirst: "Pair using the temporary code first.", selectTab: "Select a Tripo Studio tab.",
    badPair: "Incorrect or expired code. Request a new one in FITA after five failed attempts.", unauthorized: "This extension is not authorized. Pair its ID in local FITA settings.",
    expired: "The bridge session is invalid or expired. Pair again.", noReply: "The extension did not respond. Reopen its panel.",
  },
  es: {
    permissionsTitle:"Permisos y tus datos",permissionsBody:"Acceso: solo Tripo Studio y 127.0.0.1. Descargas: identificar exportaciones solicitadas. Configuración: permitir descargas múltiples solo en Studio; se retira al desconectar. Almacenamiento de sesión: emparejamiento. Almacenamiento local: idioma y recibos de exportación. Alarmas: reconectar el puente local.",
    saveDiagnostic:"Guardar diagnóstico de estructura",diagnosticSaved:"Guardado en Descargas/FITA/studio-layout-diagnostic.json. No se subieron imágenes ni se generó.",
    diagnostics:"Inspeccionar vistas cargadas",diagnosticHint:"Informe de solo lectura de casillas, hashes de archivos y controles visibles. No sube imágenes ni genera.",
    brand: "TALLER LOCAL", heading: "Conectar Tripo Studio", intro: "Conecta la pestaña que elijas. Solo lectura por defecto; los comandos del proyecto requieren tu consentimiento explícito.",
    automationConsent:"Permitir comandos explícitos del proyecto en esta pestaña",
    automationHint:"Opcional: enviar vistas aprobadas, confirmar el costo visible en el taller antes de Generar y exportar la tarea que confirmes. Nunca envía automáticamente.",
    automationReady:"Comandos autorizados para esta pestaña. Enviar imágenes y generar todavía requieren confirmaciones separadas en el taller.",
    step1: "1. Copia este ID en Configuración del taller", open: "Abrir Tripo Studio", openHint: "Abrir la página no conecta ni verifica tu cuenta.",
    step2: "2. Introduce el código que muestra el taller", pair: "Emparejar", codeHint: "8 cifras", step3: "3. Autoriza una pestaña para solo lectura", connect: "Conectar pestaña elegida",
    privacy: "Comparte el estado de la pestaña con el taller local. Los comandos autorizados verifican referencias, opciones y costo, copian miniaturas de candidatos confirmados y transfieren las exportaciones GLB solicitadas. No lee contraseñas ni cookies.",
    refresh: "Actualizar estado", disconnect: "Revocar conexión", limit: "Integración independiente; no es una extensión oficial de Tripo. Tu sesión permanece en el navegador. Puedes revocar el acceso en cualquier momento.",
    checking: "Comprobando…", noTabs: "Primero abre Tripo Studio", readable: "Conectado para inspección de solo lectura. No están autorizados los comandos del proyecto.",
    paired: "Emparejado. Elige y autoriza la pestaña.", offline: "Sin conexión. Empareja con el taller abierto en 127.0.0.1:4317.",
    genericError: "No se completó la conexión. Comprueba que el taller esté abierto, solicita otro código y elige una pestaña de Studio.",
    tabMissing: "La pestaña elegida ya no está en Tripo Studio. Selecciónala de nuevo.", noAccess: "No se pudo confirmar lectura de la página. Espera a que termine de cargar.",
    unavailableTab: "La pestaña no está disponible para lectura. Abre el panel y vuelve a conectarla.", backendOffline: "No se pudo contactar al taller local. Comprueba que siga abierto.",
    localDisconnect: "Desconectado aquí. El taller no respondió; revoca allí también o espera a que venza su sesión.", revoked: "Conexión revocada.",
    invalidCode: "Introduce el código temporal de ocho cifras del taller.", pairFirst: "Empareja primero con el código temporal.", selectTab: "Elige una pestaña de Tripo Studio.",
    badPair: "Código incorrecto o vencido. Tras cinco intentos pide otro en el taller.", unauthorized: "Extensión no autorizada. Empareja su ID en la configuración del taller local.",
    expired: "La sesión del puente venció o no es válida. Empareja otra vez.", noReply: "No respondió la extensión. Vuelve a abrir su panel.",
  },
  ja: {
    permissionsTitle:"権限とデータ",permissionsBody:"アクセス先はTripo Studioと127.0.0.1のみです。ダウンロード権限で要求した書き出しを特定します。Studioのみ複数ダウンロードを許可し、切断時に解除します。ペアリングはセッション内、言語と書き出し記録はローカルに保存します。アラームはローカル接続の再開に使います。",
    saveDiagnostic:"構造の診断を保存",diagnosticSaved:"Downloads/FITA/studio-layout-diagnostic.json に保存しました。アップロードや生成は行っていません。",
    diagnostics:"読み込み済みビューを確認",diagnosticHint:"アップロード枠、ファイルのハッシュ、表示中の操作要素を読み取り専用で確認します。アップロードや生成は行いません。",
    brand: "ローカル・ワークベンチ", heading: "Tripo Studio に接続", intro: "選択したタブに接続します。初期設定は読み取り専用です。プロジェクト操作には明示的な許可が必要です。",
    automationConsent:"このタブで明示的なプロジェクト操作を許可する",
    automationHint:"任意設定です。承認済みビューの送信、生成前のワークベンチでの料金確認、確認済みタスクの書き出しに使用します。自動送信は行いません。",
    automationReady:"このタブのプロジェクト操作が許可されました。画像の送信と生成には、ワークベンチでそれぞれ確認が必要です。",
    step1: "1. この ID をワークベンチの設定にコピー", open: "Tripo Studio を開く", openHint: "ページを開くだけでは、接続やアカウント確認は行われません。",
    step2: "2. ワークベンチに表示されたコードを入力", pair: "ペアリング", codeHint: "8 桁の数字", step3: "3. 読み取りを許可するタブを選択", connect: "選択したタブに接続",
    privacy: "タブの状態をローカルのワークベンチに送信します。許可された操作では参照画像・設定・料金を確認し、確認済み候補のサムネイルと要求されたGLBを書き出します。パスワードやCookieは読み取りません。",
    refresh: "状態を更新", disconnect: "接続を解除", limit: "Tripo公式ではない独立した連携機能です。セッションはブラウザー内に保持され、いつでも接続を解除できます。",
    checking: "確認中…", noTabs: "先に Tripo Studio を開いてください", readable: "読み取り専用の確認に接続済みです。プロジェクト操作は許可されていません。",
    paired: "ペアリング済みです。タブを選択して許可してください。", offline: "未接続です。127.0.0.1:4317 でワークベンチを起動してペアリングしてください。",
    genericError: "接続できませんでした。ワークベンチの起動を確認し、新しいコードを取得して Studio のタブを選択してください。",
    tabMissing: "選択したタブは Tripo Studio ではなくなりました。選び直してください。", noAccess: "ページの読み取りを確認できませんでした。読み込み完了を待ってください。",
    unavailableTab: "タブを読み取れません。このパネルを開き、再接続してください。", backendOffline: "ローカルのワークベンチに接続できません。起動しているか確認してください。",
    localDisconnect: "この拡張機能では接続を解除しました。ワークベンチが応答しなかったため、そちらでも解除するか有効期限をお待ちください。", revoked: "接続を解除しました。",
    invalidCode: "ワークベンチの一時コード（8 桁）を入力してください。", pairFirst: "先に一時コードでペアリングしてください。", selectTab: "Tripo Studio のタブを選択してください。",
    badPair: "コードが違うか、有効期限が切れています。5 回失敗した場合はワークベンチで再発行してください。", unauthorized: "この拡張機能は許可されていません。ローカルの設定で ID をペアリングしてください。",
    expired: "接続セッションが無効か、有効期限が切れています。再度ペアリングしてください。", noReply: "拡張機能が応答しません。パネルを開き直してください。",
  },
};
for(const [language,values] of Object.entries({
  en:{reloadWorker:'The popup is newer than the running extension worker. In Chrome/Edge Extensions, reload FITA · Tripo Studio Bridge (not the Studio page), then reopen this popup. Reloading may clear pairing; request a new code only if it shows Not connected.',adapterFailure:'The tab is readable, but its preparation adapter failed. No commands were enabled. Diagnostic: ',unsupportedWorkspace:'Project permission was received, but this page is unsupported. Open the generation workspace, select that tab, and connect.',notAcknowledged:'The local bridge did not confirm project commands. No upload is enabled. Refresh status and inspect the reported error.',step3:'3. Select a tab and its access'},
  es:{reloadWorker:'El panel es más reciente que el proceso activo de la extensión. En Extensiones de Chrome/Edge, recarga FITA · Tripo Studio Bridge (no la página de Studio) y vuelve a abrir este panel. La recarga puede borrar el emparejamiento; pide otro código solo si aparece Sin conexión.',adapterFailure:'La pestaña se puede leer, pero falló el adaptador de preparación. No se habilitaron comandos. Diagnóstico: ',unsupportedWorkspace:'Se recibió el permiso, pero esta página no es compatible. Abre el espacio de generación de Studio, selecciona esa pestaña y conecta.',notAcknowledged:'El puente local no confirmó los comandos. La subida sigue bloqueada. Actualiza el estado y revisa el error mostrado.',step3:'3. Selecciona la pestaña y su acceso'},
  ja:{reloadWorker:'パネルより古い拡張機能プロセスが動作中です。Chrome/Edgeの拡張機能管理でFITA · Tripo Studio Bridgeを再読み込みし、パネルを開き直してください。Studioのページ更新ではありません。ペアリングが消える場合があります。未接続と表示された場合だけ新しいコードを取得してください。',adapterFailure:'タブは読み取れますが、画像準備用アダプターに失敗しました。操作は有効になっていません。詳細: ',unsupportedWorkspace:'操作の許可は届きましたが、このページは非対応です。Studioの生成画面を開き、そのタブを選択して接続してください。',notAcknowledged:'ローカルブリッジが操作を確認しませんでした。アップロードは無効のままです。状態を更新してエラーを確認してください。',step3:'3. タブとアクセス権を選択'}
}))Object.assign(messages[language],values);
const errorKeys = {
  WORKER_RELOAD_REQUIRED:'reloadWorker',
  ADAPTER_UNSUPPORTED_WORKSPACE:'unsupportedWorkspace',
  COMMANDS_NOT_ACKNOWLEDGED:'notAcknowledged',
  "La pestaña elegida ya no está en Tripo Studio. Selecciónala de nuevo.": "tabMissing",
  "No se pudo confirmar acceso a la página. Espera a que termine de cargar.": "noAccess",
  "La pestaña no está disponible para lectura. Abre el panel y vuelve a conectarla.": "unavailableTab",
  "No se pudo contactar al taller local. Comprueba que siga abierto.": "backendOffline",
  "Desconectado aquí. Si el taller estaba apagado, su sesión vencerá o puedes revocarla desde Configuración.": "localDisconnect",
  "Conexión revocada.": "revoked",
  "Introduce el código temporal de ocho cifras del taller.": "invalidCode",
  "Empareja primero con el código temporal.": "pairFirst",
  "Elige una pestaña de Tripo Studio.": "selectTab",
  "Código incorrecto o vencido. Tras cinco intentos es necesario crear otro.": "badPair",
  "El código venció. Genera otro en el taller.": "badPair",
  "Extensión no autorizada. Empareja su ID desde el taller local.": "unauthorized",
  "Sesión del puente inválida o vencida. Vuelve a emparejar.": "expired",
  "No respondió la extensión. Vuelve a abrir su panel.": "noReply",
};
export function translateError(text, language) {
  if(/^ADAPTER_(NO_RESPONSE|EXECUTION_FAILED)/.test(text))return (messages[language]||messages.en).adapterFailure+text;
  return messages[language]?.[errorKeys[text] || "genericError"] || messages.en.genericError;
}

messages.en.connectedWorkspace="Connected. This page can be inspected. FITA will check the controls required by each operation.";
messages.es.connectedWorkspace="Conectado. Esta página se puede inspeccionar. El taller comprobará los controles necesarios para cada operación.";
messages.ja.connectedWorkspace="接続済み。このページは確認できます。操作ごとに必要なコントロールを確認します。";

messages.en.reloadExtension="Reload extension";
messages.es.reloadExtension="Recargar extensión";
messages.ja.reloadExtension="拡張機能を再読み込み";
