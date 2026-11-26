; knit Windows Installer — Inno Setup 6 (docs/03 §8, docs/07 M5.6)
; Build with: iscc installer\knit.iss
;
; Uninstall strictly removes only installed binaries and temporary caches;
; user git repositories and `.git/knit/` data are NEVER touched.

#define MyAppName "knit"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "zhimoe"
#define MyAppId "com.zhimoe.knit"
#define MyAppExeName "knit.exe"

[Setup]
AppId={{{#MyAppId}}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
PrivilegesRequired=lowest
OutputDir=..\dist\installer
OutputBaseFilename=knit-setup-{#MyAppVersion}-x64
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\dist\knit.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\WebView2Loader.dll"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\dist\resources\*"; DestDir: "{app}\resources"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[UninstallDelete]
; Clean transient diff blobs & logs under %APPDATA%\knit on uninstall.
; Keep settings.json / agents.json unless user manually deletes them, and NEVER touch repos.
Type: filesandordirs; Name: "{userappdata}\knit\blobs"
Type: filesandordirs; Name: "{userappdata}\knit\logs"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
