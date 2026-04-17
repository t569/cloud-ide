// shared/src/constants/iconRegistry.ts

import { ResolvedIcon } from "../../utils/iconResolver";

// ============================================================================
// TIER 1: EXACT FILENAMES
// ============================================================================
// Highest Priority: Matches the full string of the filename.
// Use this for config files, lockfiles, and dotfiles where the extension alone 
// (e.g., .json, .yaml) isn't specific enough to determine the tool/framework.
// ============================================================================

// map multiple file extensions to a single file icon
export const mapExtensions = (extensions: string[], iconDef: ResolvedIcon): Record<string, ResolvedIcon> => {
  return extensions.reduce((acc, ext) => {
    acc[ext] = iconDef;
    return acc;
  }, {} as Record<string, ResolvedIcon>);
};


export const FILE_NAME_MAP: Record<string, ResolvedIcon> = {
  
  // --- Package Managers & Core Build Tools ---
  ...mapExtensions(['package.json', 'package-lock.json'], { icon: 'vscode-icons:file-type-npm' }),
  ...mapExtensions(['cargo.toml', 'cargo.lock'], { icon: 'vscode-icons:file-type-cargo' }),
  ...mapExtensions(['go.mod', 'go.sum'], { icon: 'vscode-icons:file-type-go' }),
  'pom.xml': { icon: 'vscode-icons:file-type-maven' },
  'gradlew': { icon: 'vscode-icons:file-type-gradle' },
  'makefile': { icon: 'vscode-icons:file-type-makefile' },
  'cmakelists.txt': { icon: 'vscode-icons:file-type-cmake' },
  'meson.build': { icon: 'vscode-icons:file-type-meson' },
  'meson_options.txt': { icon: 'file-icons:meson', color: '#882255' },

  // --- Linters, Formatters & Framework Configs ---
  ...mapExtensions(['swagger.json', 'swagger.yaml'], { icon: 'file-icons:swagger', color: '#85EA2D' }),
  ...mapExtensions(['apollo.config.js', 'apollo.config.ts'], { icon: 'devicon:apollographql'}),
  ...mapExtensions(['tailwind.config.js', 'tailwind.config.ts'], { icon: 'file-icons:tailwind', color: '#06B6D4' }),
  ...mapExtensions(['.eslintrc', '.eslintrc.js', '.eslintrc.json'], { icon: 'file-icons:eslint', color: '#4B32C3' }),
  ...mapExtensions([  
    '.prettierrc', '.prettierrc.json', '.prettierrc.yml', '.prettierrc.yaml', 
    '.prettierrc.json5', '.prettierrc.toml', '.prettierrc.js', '.prettierrc.cjs', 
    '.prettierrc.ts', 'prettier.config.js', 'prettier.config.mjs', 'prettier.config.cjs', 
    '.prettierignore'
  ], { icon: 'logos:prettier' }),

  // --- Servers, Infrastructure & Databases ---
  ...mapExtensions(['dockerfile', 'docker-compose.yml'], { icon: 'logos:docker-icon' }),
  ...mapExtensions(['.htaccess', 'httpd.conf'], { icon: 'devicon:apache' }),
  '.dockerignore': { icon: 'file-icons:docker', color: '#808080' },
  'kubeconfig': { icon: 'devicon:kubernetes' },
  'nginx.conf': { icon: 'file-icons:nginx', color: '#009639' },
  'redis.conf': { icon: 'devicon:redis' },

  // --- Environment Variables & Dotfiles ---
  ...mapExtensions(['.env', '.env.local'], { icon: 'vscode-icons:file-type-dotenv' }),
  '.vimrc': { icon: 'devicon:vim' },
  '.emacs': { icon: 'file-icons:emacs', color: '#7F5AB6' },
  '.curlrc': { icon: 'file-icons:curl-lang', color: '#073551' },
  '.nanorc': { icon: 'file-icons:nano', color: '#555555' },
  '.condarc': { icon: 'file-icons:conda', color: '#44A833' },

  // --- Project Metadata & Miscellaneous ---
  'readme.md': { icon: 'vscode-icons:file-type-markdown' },
  'license': { icon: 'vscode-icons:file-type-license' },
  '.gitignore': { icon: 'simple-icons:git', color: '#F05032' },
  'androidmanifest.xml': { icon: 'devicon:android' },
  'modelfile': { icon: 'devicon:ollama' }, // Local AI Models
};

// ============================================================================
// TIER 2: EXTENSION MATCHES
// ============================================================================
// Standard Priority: Matches the file extension (everything after the last dot). 
// Grouped by domain/category for easy maintenance.
// ============================================================================

export const EXTENSION_MAP: Record<string, ResolvedIcon> = {
  
  // --- Systems, Compiled & Low-Level Languages ---
  ...mapExtensions(['c', 'h'], { icon: 'devicon:embeddedc' }),
  'cpp': { icon: 'vscode-icons:file-type-cpp' },
  'hpp': { icon: 'vscode-icons:file-type-cppheader' }, // Headers get a distinct icon in VS Code
  'rs': { icon: 'simple-icons:rust', color: '#DEA584' },
  'go': { icon: 'vscode-icons:file-type-go' },
  'zig': { icon: 'simple-icons:zig', color: '#F7A41D' },
  'swift': { icon: 'simple-icons:swift', color: '#F05138' },
  'nim': { icon: 'simple-icons:nim', color: '#FFE953' },
  'd': { icon: 'vscode-icons:file-type-dlang' },
  'odin': { icon: 'local:odin' },
  'c3': { icon: 'local:c3' },
  'carbon': { icon: 'local:carbon' },

  // --- Assembly, Compilers, Linkers & Binaries ---
  ...mapExtensions(['ll', 'llvm'], { icon: 'devicon:llvm' }),
  ...mapExtensions(['ld', 'lds', 'asm', 's'], { icon: 'vscode-icons:file-type-assembly' }),
  ...mapExtensions(['o', 'so', 'dll'], { icon: 'vscode-icons:file-type-binary' }),
  'wasm': { icon: 'simple-icons:webassembly', color: '#654FF0' },
  'nasm': {icon: 'logos:nasm'},
  'cmake': { icon: 'vscode-icons:file-type-cmake' },

  // --- Enterprise, JVM & .NET ---
  ...mapExtensions(['fs', 'fsx'], { icon: 'vscode-icons:file-type-fsharp' }),
  'java': { icon: 'vscode-icons:file-type-java' },
  'class': { icon: 'vscode-icons:file-type-class' },
  'jar': { icon: 'vscode-icons:file-type-jar' },
  'kt': { icon: 'simple-icons:kotlin', color: '#7F52FF' },
  'scala': { icon: 'devicon:scala' },
  'groovy': { icon: 'vscode-icons:file-type-groovy' },
  'cs': { icon: 'vscode-icons:file-type-csharp' },
  'vb': { icon: 'vscode-icons:file-type-vb' },
  'dart': { icon: 'simple-icons:dart', color: '#779ECB' },

  // --- Web, UI & Scripting Languages ---
  ...mapExtensions(['tsx', 'jsx'], { icon: 'logos:react' }),
  ...mapExtensions(['ggl', 'graphql'], { icon: 'file-icons:graphql', color: '#E10098' }),
  ...mapExtensions(['pl', 'pm', 't'], { icon: 'simple-icons:perl', color: '#39457E' }),
  ...mapExtensions(['rb', 'erb'], { icon: 'vscode-icons:file-type-ruby' }),
  ...mapExtensions(['jinja', 'jinja2', 'j2'], { icon: 'file-icons:jinja', color: '#B41717' }),

  // --- Styling, CSS & Preprocessors ---
  'css': { icon: 'vscode-icons:file-type-css' },
  ...mapExtensions(['scss', 'sass'], { icon: 'vscode-icons:file-type-scss' }),
  'less': { icon: 'vscode-icons:file-type-less' },
  ...mapExtensions(['styl', 'stylus'], { icon: 'vscode-icons:file-type-stylus' }),
  
  'js': { icon: 'logos:javascript' },
  'mjs': { icon: 'logos:nodejs-icon' },
  'ts': { icon: 'logos:typescript-icon' },
  'vue': { icon: 'logos:vue' },
  'htmx': { icon: 'devicon:htmx' },
  'php': { icon: 'vscode-icons:file-type-php' },
  'lua': { icon: 'devicon:lua' },
  'twig': { icon: 'file-icons:twig', color: '#A1C900' },
  'coffee': { icon: 'devicon:coffeescript' },

  // --- Data Science, Math, AI & Databases ---
  ...mapExtensions(['py', 'pyi', 'pyw', 'pyc', 'pyo', 'pyd'], { icon: 'vscode-icons:file-type-python' }),
  ...mapExtensions(['rdata', 'rds'], { icon: 'file-icons:rdata', color: '#276DC3' }),
  ...mapExtensions(['nb', 'wl'], { icon: 'file-icons:mathematica', color: '#DD1100' }),
  ...mapExtensions(['pt', 'pth'], { icon: 'devicon:pytorch' }),
  ...mapExtensions(['db', 'sqlite', 'sqlite3'], { icon: 'file-icons:sqlite', color: '#003B57' }),
  ...mapExtensions(['mojo', '🔥'], { icon: 'vscode-icons:file-type-mojo' }),
  'jl': { icon: 'devicon:julia' },
  'm': { icon: 'vscode-icons:file-type-matlab' },
  'sas': { icon: 'file-icons:sas', color: '#035CA4' },
  'sql': { icon: 'vscode-icons:file-type-sql' },
  'bson': { icon: 'devicon:mongodb' },
  'rdb': { icon: 'devicon:redis' },
  'ipynb': { icon: 'simple-icons:jupyter', color: '#F37626' },
  'r': { icon: 'devicon:r' },

  // --- Functional & Niche Languages ---
  ...mapExtensions(['ml', 'mli'], { icon: 'devicon:ocaml' }),
  ...mapExtensions(['ex', 'exs'], { icon: 'devicon:elixir' }),
  ...mapExtensions(['clj', 'cljs'], { icon: 'devicon:clojure' }),
  ...mapExtensions(['pyx', 'pyd'], { icon: 'file-icons:cython', color: '#F2D411' }),
  ...mapExtensions(['pp', 'pas'], { icon: 'file-icons:pascal', color: '#E2A229' }),
  ...mapExtensions(['res', 'resi'], { icon: 'file-icons:rescript', color: '#E64E4B' }),
  'hs': { icon: 'simple-icons:haskell', color: '#5D4F85' },
  'erl': { icon: 'simple-icons:erlang', color: '#A90533' },
  'nix': { icon: 'devicon:nixos' },
  'elm': { icon: 'devicon:elm' },
  'hx': { icon: 'devicon:haxe' },
  'el': { icon: 'file-icons:emacs', color: '#7F5AB6' },

  // --- Hardware, Graphics & Game Dev ---
  ...mapExtensions(['v', 'sv', 'svh'], { icon: 'vscode-icons:file-type-systemverilog' }),
  ...mapExtensions(['glsl', 'vert', 'frag'], { icon: 'file-icons:opengl', color: '#5586A4' }),
  ...mapExtensions(['unity', 'prefab'], { icon: 'devicon:unity' }),
  ...mapExtensions(['cu', 'cuh'], { icon: 'file-icons:nvidia', color: '#76B900' }),
  'ino': { icon: 'devicon:arduino' },
  'webgl': { icon: 'file-icons:webgl', color: '#990000' },
  'wgsl': { icon: 'devicon:webgpu' },
  'gd': { icon: 'simple-icons:godotengine', color: '#478CBF' },
  'blend': { icon: 'devicon:blender' },
  'uc': { icon: 'file-icons:unrealscript', color: '#7A7A7A' },

  // --- Legacy, Mainframes & Apple Ecosystem ---
  ...mapExtensions(['f', 'f90'], { icon: 'simple-icons:fortran', color: '#734F96' }),
  ...mapExtensions(['ada', 'adb'], { icon: 'vscode-icons:file-type-ada' }),
  ...mapExtensions(['cob', 'cbl'], { icon: 'vscode-icons:file-type-cobol' }),
  ...mapExtensions(['app', 'dmg'], { icon: 'devicon:apple' }), // macOS disk image and app bundle
  'mm': { icon: 'vscode-icons:file-type-objectivec' },

  // --- ZKP & Blockchain ---
  'nr': { icon: 'local:noir' },
  'sol': { icon: 'simple-icons:solidity', color: '#363636' },
  'circom': { icon: 'vscode-icons:file-type-circom' },

  // --- Shells, OS, Executables & Installers ---
  ...mapExtensions(['ps1', 'psm1'], { icon: 'vscode-icons:file-type-powershell' }),
  ...mapExtensions(['bat', 'cmd'], { icon: 'file-icons:ms-dos', color: '#C4C4C4' }),
  ...mapExtensions(['exe', 'msi'], { icon: 'logos:microsoft-windows-icon' }), 
  'sh': { icon: 'logos:bash-icon' },
  'bash': { icon: 'skill-icons:linux-light' },
  'wasi': { icon: 'file-icons:wasi', color: '#654FF0' },
  'apk': { icon: 'devicon:android' }, // Android package
  'rpm': { icon: 'logos:redhat-icon' },
  'deb': { icon: 'logos:debian' },
  'pkg': { icon: 'logos:freebsd' }, 

  // --- Data, Configs & Serialization ---
  ...mapExtensions(['yml', 'yaml'], { icon: 'vscode-icons:file-type-yaml' }),
  ...mapExtensions(['conf', 'cfg', 'ini'], { icon: 'vscode-icons:file-type-light-ini' }),
  'json': { icon: 'vscode-icons:file-type-json' },
  'toml': { icon: 'vscode-icons:file-type-toml' },
  'xml': { icon: 'vscode-icons:file-type-xml' },
  'csv': { icon: 'file-icons:csv', color: '#2E8B73' },

  // --- Generic Media (Images, Audio, Video, Archives) ---
  ...mapExtensions(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'], { icon: 'vscode-icons:file-type-image' }),
  ...mapExtensions(['mp3', 'wav', 'flac', 'ogg'], { icon: 'vscode-icons:file-type-audio' }),
  ...mapExtensions(['mp4', 'mkv', 'avi', 'mov', 'webm'], { icon: 'vscode-icons:file-type-video' }),
  ...mapExtensions(['zip', 'tar', 'gz', '7z', 'rar'], { icon: 'vscode-icons:file-type-zip' }),

  // --- Docs, Publishing & Logs ---
  ...mapExtensions(['txt', 'rtf'], { icon: 'vscode-icons:file-type-text' }),
  'log': { icon: 'vscode-icons:file-type-log' },
  'md': { icon: 'vscode-icons:file-type-markdown' },
  'bib': { icon: 'file-icons:bibtex', color: '#e3b341' },
  'tex': { icon: 'simple-icons:latex', color: '#008080' },
  'pdf': { icon: 'vscode-icons:file-type-pdf2' },

  // --- IDE & Workspace Files ---
  ...mapExtensions(['sln', 'csproj'], { icon: 'devicon:visualstudio' }),
  'xcodeproj': { icon: 'devicon:xcode' },
  'vim': { icon: 'devicon:vim' },
};