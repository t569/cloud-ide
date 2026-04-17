// shared/src/constants/iconRegistry.ts
import { ResolvedIcon } from "../../utils/iconResolver"

// ==========================================
// TIER 1: EXACT FILENAMES
// ==========================================
// These take top priority. A package.json gets the NPM logo, not the standard JSON logo.
// Matches the full filename. Useful for config files where the extension 
// alone isn't enough to determine the tool (e.g., a .json could be anything, 
// but package.json is definitively NPM).
export const FILE_NAME_MAP: Record<string, ResolvedIcon> = {
  // --- Package Managers & Build Tools ---
  'package.json': { icon: 'vscode-icons:file-type-npm' },
  'package-lock.json': { icon: 'vscode-icons:file-type-npm' },
  'cargo.toml': { icon: 'vscode-icons:file-type-cargo' },
  'cargo.lock': { icon: 'vscode-icons:file-type-cargo' },
  'go.mod': { icon: 'vscode-icons:file-type-go' },
  'go.sum': { icon: 'vscode-icons:file-type-go' },
  'pom.xml': { icon: 'vscode-icons:file-type-maven' },
  'gradlew': { icon: 'vscode-icons:file-type-gradle' },
  'makefile': { icon: 'vscode-icons:file-type-makefile' },
  'cmakelists.txt': { icon: 'vscode-icons:file-type-cmake' },
  'meson.build': { icon: 'vscode-icons:file-type-meson' },
  'meson_options.txt': { icon: 'file-icons:meson', color: '#882255' },

  // --- Linters, Formatters & Framework Configs ---
  '.eslintrc': { icon: 'file-icons:eslint', color: '#4B32C3' },
  '.eslintrc.js': { icon: 'file-icons:eslint', color: '#4B32C3' },
  '.eslintrc.json': { icon: 'file-icons:eslint', color: '#4B32C3' },
  'tailwind.config.js': { icon: 'file-icons:tailwind', color: '#06B6D4' },
  'tailwind.config.ts': { icon: 'file-icons:tailwind', color: '#06B6D4' },
  'apollo.config.js': { icon: 'devicon:apollographql' },
  'apollo.config.ts': { icon: 'devicon:apollographql' },
  'swagger.json': { icon: 'file-icons:swagger', color: '#85EA2D' },
  'swagger.yaml': { icon: 'file-icons:swagger', color: '#85EA2D' },
  '.prettierrc': {icon: 'logos:prettier'},
  '.prettierignore': {icon: 'logos:prettier'},
//   '.prettierrc.json'
// '.prettierrc.yml'
// '.prettierrc.yaml'
// ''.prettierrc.json5'
// '.prettierrc.toml'
// 'prettier.config.js'
// '.prettierrc.js'
// 'prettier.config.mjs'
// '.prettierrc.cjs'
// 'prettier.config.cjs'
// '.prettierrc.ts'



  // --- Servers, Infrastructure & DBs ---
  'dockerfile': { icon: 'logos:docker-icon' },
  'docker-compose.yml': { icon: 'logos:docker-icon' },
  '.dockerignore': {icon: 'file-icons:docker', color: '#808080'},
  'kubeconfig': { icon: 'devicon:kubernetes' },
  'nginx.conf': { icon: 'file-icons:nginx', color: '#009639' },
  '.htaccess': { icon: 'devicon:apache' },
  'httpd.conf': { icon: 'devicon:apache' },
  'redis.conf': { icon: 'devicon:redis' },

  // --- Environment & Dotfiles ---
  '.env': { icon: 'vscode-icons:file-type-dotenv' },
  '.env.local': { icon: 'vscode-icons:file-type-dotenv' },
  '.vimrc': { icon: 'devicon:vim' },
  '.emacs': { icon: 'file-icons:emacs', color: '#7F5AB6' },
  '.curlrc': { icon: 'file-icons:curl-lang', color: '#073551' },
  '.nanorc': { icon: 'file-icons:nano', color: '#555555' },
  '.condarc': { icon: 'file-icons:conda', color: '#44A833' },

  // --- Project Metadata & Misc ---
  'readme.md': { icon: 'vscode-icons:file-type-markdown' },
  'license': { icon: 'vscode-icons:file-type-license' },
  '.gitignore': { icon: 'simple-icons:git', color: '#F05032' },
  'androidmanifest.xml': { icon: 'devicon:android' },
  'modelfile': { icon: 'devicon:ollama' }, // Local AI Models
};

// ==========================================
// TIER 2: EXTENSIONS
// ==========================================
// These handle standard file types.
// Matches the file extension (everything after the last dot). 
// Grouped by category for easy maintenance.
export const EXTENSION_MAP: Record<string, ResolvedIcon> = {
  // --- Systems, Compiled & Low-Level ---
  'c': { icon: 'devicon:embeddedc' },
  'h': { icon: 'devicon:embeddedc' },
  'cpp': { icon: 'vscode-icons:file-type-cpp' },
  'hpp': { icon: 'vscode-icons:file-type-cppheader' },
  'rs': { icon: 'simple-icons:rust', color: '#DEA584' },
  'go': { icon: 'vscode-icons:file-type-go' },
  'zig': { icon: 'simple-icons:zig', color: '#F7A41D' },
  'swift': { icon: 'simple-icons:swift', color: '#F05138' },
  'nim': { icon: 'simple-icons:nim', color: '#FFE953' },
  'd': { icon: 'vscode-icons:file-type-dlang' },
  'odin': { icon: 'local:odin' },
  'c3': { icon: 'local:c3' },
  'carbon': { icon: 'local:carbon' },
  
  // --- Assembly, Compilers & Linkers ---
  'asm': { icon: 'vscode-icons:file-type-assembly' },
  's': { icon: 'vscode-icons:file-type-assembly' },
  'wasm': { icon: 'simple-icons:webassembly', color: '#654FF0' },
  'll': { icon: 'devicon:llvm' },
  'llvm': { icon: 'devicon:llvm' },
  'ld': { icon: 'vscode-icons:file-type-assembly' },
  'lds': { icon: 'vscode-icons:file-type-assembly' },
  'cmake': { icon: 'vscode-icons:file-type-cmake' },
  'o': { icon: 'vscode-icons:file-type-binary' },
  'so': { icon: 'vscode-icons:file-type-binary' },
  'dll': { icon: 'vscode-icons:file-type-binary' },

  // --- Enterprise, JVM & .NET ---
  'java': { icon: 'vscode-icons:file-type-java' },
  'class': { icon: 'vscode-icons:file-type-class' },
  'jar': { icon: 'vscode-icons:file-type-jar' },
  'kt': { icon: 'simple-icons:kotlin', color: '#7F52FF' },
  'scala': { icon: 'devicon:scala' },
  'groovy': { icon: 'vscode-icons:file-type-groovy' },
  'cs': { icon: 'vscode-icons:file-type-csharp' },
  'fs': { icon: 'vscode-icons:file-type-fsharp' },
  'fsx': { icon: 'vscode-icons:file-type-fsharp' },
  'vb': { icon: 'vscode-icons:file-type-vb' },
  'dart': {icon: 'simple-icons:dart', color: '#779ECB'},

  // --- Web, UI & Scripting ---
  'js': { icon: 'logos:javascript' },
  'mjs': { icon: 'logos:nodejs-icon' },
  'ts': { icon: 'logos:typescript-icon' },
  'tsx': { icon: 'logos:react' },
  'jsx': { icon: 'logos:react' },
  'vue': { icon: 'logos:vue' },
  'htmx': { icon: 'devicon:htmx' },
  'graphql': { icon: 'file-icons:graphql', color: '#E10098' },
  'gql': { icon: 'file-icons:graphql', color: '#E10098' },
  'php': { icon: 'vscode-icons:file-type-php' },
  'rb': { icon: 'vscode-icons:file-type-ruby' },
  'erb': { icon: 'vscode-icons:file-type-ruby' },
  'pl': { icon: 'simple-icons:perl', color: '#39457E' },
  'pm': { icon: 'simple-icons:perl', color: '#39457E' },
  't': { icon: 'simple-icons:perl', color: '#39457E' },
  'lua': { icon: 'devicon:lua' },
  'coffee': { icon: 'devicon:coffeescript' },
  'twig': { icon: 'file-icons:twig', color: '#A1C900' },
  'jinja': { icon: 'file-icons:jinja', color: '#B41717' },
  'jinja2': { icon: 'file-icons:jinja', color: '#B41717' },
  'j2': { icon: 'file-icons:jinja', color: '#B41717' },

  // --- Data Science, Math, AI & DBs ---
  'py': { icon: 'vscode-icons:file-type-python' },
  'pyi': { icon: 'vscode-icons:file-type-python' },
  'pyw': { icon: 'vscode-icons:file-type-python' },
  'pyc': { icon: 'vscode-icons:file-type-python' },
  'pyo': { icon: 'vscode-icons:file-type-python' },
  'pyd': { icon: 'vscode-icons:file-type-python' },
  'ipynb': { icon: 'simple-icons:jupyter', color: '#F37626' },
  'r': { icon: 'devicon:r' },
  'rdata': { icon: 'file-icons:rdata', color: '#276DC3' },
  'rds': { icon: 'file-icons:rdata', color: '#276DC3' },
  'jl': { icon: 'devicon:julia' },
  'm': { icon: 'vscode-icons:file-type-matlab' },
  'nb': { icon: 'file-icons:mathematica', color: '#DD1100' },
  'wl': { icon: 'file-icons:mathematica', color: '#DD1100' },
  'sas': { icon: 'file-icons:sas', color: '#035CA4' },
  'mojo': { icon: 'vscode-icons:file-type-mojo' },
  '🔥': { icon: 'vscode-icons:file-type-mojo' },
  'pt': { icon: 'devicon:pytorch' },
  'pth': { icon: 'devicon:pytorch' },
  'sql': { icon: 'vscode-icons:file-type-sql' },
  'sqlite': { icon: 'file-icons:sqlite', color: '#003B57' },
  'sqlite3': { icon: 'file-icons:sqlite', color: '#003B57' },
  'db': { icon: 'file-icons:sqlite', color: '#003B57' },
  'bson': { icon: 'devicon:mongodb' },
  'rdb': { icon: 'devicon:redis' },

  // --- Functional & Niche Languages ---
  'ml': { icon: 'simple-icons:ocaml', color: '#EC6813' },
  'mli': { icon: 'simple-icons:ocaml', color: '#EC6813' },
  'hs': { icon: 'simple-icons:haskell', color: '#5D4F85' },
  'erl': { icon: 'simple-icons:erlang', color: '#A90533' },
  'ex': { icon: 'devicon:elixir' },
  'exs': { icon: 'devicon:elixir' },
  'clj': { icon: 'devicon:clojure' },
  'cljs': { icon: 'devicon:clojure' },
  'nix': { icon: 'devicon:nixos' },
  'elm': { icon: 'devicon:elm' },
  'hx': { icon: 'devicon:haxe' },
  'pyx': { icon: 'file-icons:cython', color: '#F2D411' },
  'pxd': { icon: 'file-icons:cython', color: '#F2D411' },
  'el': { icon: 'file-icons:emacs', color: '#7F5AB6' },
  'pas': { icon: 'file-icons:pascal', color: '#E2A229' },
  'pp': { icon: 'file-icons:pascal', color: '#E2A229' },
  'res': { icon: 'file-icons:rescript', color: '#E64E4B' },
  'resi': { icon: 'file-icons:rescript', color: '#E64E4B' },

  // --- Hardware, Graphics & Game Dev ---
  'ino': { icon: 'devicon:arduino' },
  'cu': { icon: 'file-icons:nvidia', color: '#76B900' },
  'cuh': { icon: 'file-icons:nvidia', color: '#76B900' },
  'v': { icon: 'vscode-icons:file-type-systemverilog' },
  'sv': { icon: 'vscode-icons:file-type-systemverilog' },
  'svh': { icon: 'file-icons:systemverilog', color: '#0A3A8D' },
  'glsl': { icon: 'file-icons:opengl', color: '#5586A4' },
  'vert': { icon: 'file-icons:opengl', color: '#5586A4' },
  'frag': { icon: 'file-icons:opengl', color: '#5586A4' },
  'webgl': { icon: 'file-icons:webgl', color: '#990000' },
  'wgsl': { icon: 'devicon:webgpu' },
  'unity': { icon: 'devicon:unity' },
  'prefab': { icon: 'devicon:unity' },
  'gd': { icon: 'simple-icons:godotengine', color: '#478CBF' },
  'blend': { icon: 'devicon:blender' },
  'uc': { icon: 'file-icons:unrealscript', color: '#7A7A7A' },

  // --- Legacy, Mainframes & Apple ---
  'cob': { icon: 'vscode-icons:file-type-cobol' },
  'cbl': { icon: 'vscode-icons:file-type-cobol' },
  'f90': { icon: 'simple-icons:fortran', color: '#734F96' },
  'f': { icon: 'simple-icons:fortran', color: '#734F96' },
  'ada': { icon: 'vscode-icons:file-type-ada' },
  'adb': { icon: 'vscode-icons:file-type-ada' },
  'mm': { icon: 'vscode-icons:file-type-objectivec' },

  // --- ZKP & Blockchain ---
  'nr': { icon: 'local:noir' },
  'sol': { icon: 'simple-icons:solidity', color: '#363636' },
  'circom': { icon: 'vscode-icons:file-type-circom' },

  // --- Shells, OS & Automation ---
  'sh': { icon: 'logos:bash-icon' },
  'bash': { icon: 'skill-icons:linux-light' },
  'ps1': { icon: 'vscode-icons:file-type-powershell' },
  'psm1': { icon: 'vscode-icons:file-type-powershell' },
  'bat': { icon: 'file-icons:ms-dos', color: '#C4C4C4' },
  'cmd': { icon: 'file-icons:ms-dos', color: '#C4C4C4' },
  'wasi': { icon: 'file-icons:wasi', color: '#654FF0' },

  // -- Executables and Binaries ---
  'exe': { icon: 'logos:microsoft-windows-icon'}, // Standard Windows executable, we use the windows icon for now
  'msi': { icon: 'logos:microsoft-windows-icon' }, // Windows installer, we use the windows icon for now
  'apk': { icon: 'devicon:android' },            // Android package
  'app': { icon: 'devicon:apple' },              // macOS app bundle
  'dmg': { icon: 'devicon:apple' },              // macOS disk image
  'rpm': {icon: 'logos:redhat-icon' },
  'deb': {icon: 'logos:debian' },
  'pkg': {icon: 'logos:freebsd'}, 


  // --- Data, Configs & Serialization ---
  'json': { icon: 'vscode-icons:file-type-json' },
  'yaml': { icon: 'vscode-icons:file-type-yaml' },
  'yml': { icon: 'vscode-icons:file-type-yaml' },
  'toml': { icon: 'vscode-icons:file-type-toml' },
  'xml': { icon: 'vscode-icons:file-type-xml' },
  'csv': { icon: 'file-icons:csv', color: '#2E8B73' },
  'ini': { icon: 'vscode-icons:file-type-light-ini' },
  'cfg': { icon: 'vscode-icons:file-type-light-ini' },
  'conf': { icon: 'vscode-icons:file-type-light-ini' },

  // --- Generic Media (Images, Audio, Video, Archives) ---
  'png': { icon: 'vscode-icons:file-type-image' },
  'jpg': { icon: 'vscode-icons:file-type-image' },
  'jpeg': { icon: 'vscode-icons:file-type-image' },
  'gif': { icon: 'vscode-icons:file-type-image' },
  'svg': { icon: 'vscode-icons:file-type-image' },
  'webp': { icon: 'vscode-icons:file-type-image' },
  'ico': { icon: 'vscode-icons:file-type-image' },
  'mp3': { icon: 'vscode-icons:file-type-audio' },
  'wav': { icon: 'vscode-icons:file-type-audio' },
  'flac': { icon: 'vscode-icons:file-type-audio' },
  'ogg': { icon: 'vscode-icons:file-type-audio' },
  'mp4': { icon: 'vscode-icons:file-type-video' },
  'mkv': { icon: 'vscode-icons:file-type-video' },
  'avi': { icon: 'vscode-icons:file-type-video' },
  'mov': { icon: 'vscode-icons:file-type-video' },
  'webm': { icon: 'vscode-icons:file-type-video' },
  'zip': { icon: 'vscode-icons:file-type-zip' },
  'tar': { icon: 'vscode-icons:file-type-zip' },
  'gz': { icon: 'vscode-icons:file-type-zip' },
  '7z': { icon: 'vscode-icons:file-type-zip' },
  'rar': { icon: 'vscode-icons:file-type-zip' },

  // --- Docs, Publishing & Logs ---
  'txt': { icon: 'vscode-icons:file-type-text' },
  'rtf': { icon: 'vscode-icons:file-type-text' },
  'log': { icon: 'vscode-icons:file-type-log' },
  'md': { icon: 'vscode-icons:file-type-markdown' },
  'bib': { icon: 'file-icons:bibtex', color: '#e3b341' },
  'tex': { icon: 'simple-icons:latex', color: '#008080' },
  'pdf': { icon: 'vscode-icons:file-type-pdf2' },

  // --- IDE & Workspace Files ---
  'sln': { icon: 'devicon:visualstudio' },
  'csproj': { icon: 'devicon:visualstudio' },
  'xcodeproj': { icon: 'devicon:xcode' },
  'vim': { icon: 'devicon:vim' },
};