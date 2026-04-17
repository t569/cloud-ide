// shared/src/constants/iconRegistry.ts

/**
 * To add icons you can check: 
 * https://icones.js.org/
 * https://icon-sets.iconify.design/
 * And any other ones you find
 * Simply copy the icon name e.g. logos:file icon 
 * And our icon engine will resolve it
 */
import { ResolvedIcon } from "../../utils/iconResolver";

// map multiple file extensions to a single file icon
export const mapExtensions = (extensions: string[], iconDef: ResolvedIcon): Record<string, ResolvedIcon> => {
  return extensions.reduce((acc, ext) => {
    acc[ext] = iconDef;
    return acc;
  }, {} as Record<string, ResolvedIcon>);
};

// ============================================================================
// TIER 1: EXACT FILENAMES
// ============================================================================
// Highest Priority: Matches the full string of the filename.
// ============================================================================

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
  ...mapExtensions(['meson_option.txt','meson.options'], { icon: 'file-icons:meson', color: '#882255' }),
  'yarn.lock': { icon: 'vscode-icons:file-type-yarn' },

  // --- Build Systems (Linux Kernel, Rust, LLVM) ---
  'configure': { icon: 'logos:bash-icon' },
  'makefile.in': { icon: 'vscode-icons:file-type-makefile' },
  'make.defaults': { icon: 'vscode-icons:file-type-makefile' },
  'make.rules': { icon: 'vscode-icons:file-type-makefile' },
  'kbuild': { icon: 'vscode-icons:file-type-makefile' },
  'kconfig': { icon: 'file-icons:config', color: '#666666' },

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
  '.eslintignore': { icon: 'file-icons:eslint', color: '#4B32C3' },
  ...mapExtensions(['.clang-format','.clang-format-ignore','.clang-tidy'],  { icon: 'simple-icons:llvm', color: '#1084D0' }),
  'doxyfile': { icon: 'file-icons:doxygen', color: '#095AAA' },

  // --- Servers, Infrastructure & Databases ---
  ...mapExtensions(['dockerfile', 'docker-compose.yml'], { icon: 'logos:docker-icon' }),
  ...mapExtensions(['.htaccess', 'httpd.conf'], { icon: 'devicon:apache' }),
  '.dockerignore': { icon: 'file-icons:docker', color: '#808080' },
  'kubeconfig': { icon: 'devicon:kubernetes' },
  'nginx.conf': { icon: 'file-icons:nginx', color: '#009639' },
  'redis.conf': { icon: 'devicon:redis' },
  'my.cnf': { icon: 'devicon:mysql' },
  'postgresql.conf': { icon: 'devicon:postgresql' },
  'pg_hba.conf': { icon: 'devicon:postgresql' },
  'tnsnames.ora': { icon: 'devicon:oracle' },

  // --- Environment Variables & Dotfiles ---
  ...mapExtensions(['.env', '.env.local', '.env.example'], { icon: 'vscode-icons:file-type-dotenv' }),
  '.editorconfig': { icon: 'vscode-icons:file-type-editorconfig' },
  '.npmrc': { icon: 'vscode-icons:file-type-npm' },
  '.nvmrc': { icon: 'logos:nodejs-icon' },
  '.vimrc': { icon: 'devicon:vim' },
  '.emacs': { icon: 'file-icons:emacs', color: '#7F5AB6' },
  '.curlrc': { icon: 'file-icons:curl-lang', color: '#073551' },
  '.nanorc': { icon: 'file-icons:nano', color: '#555555' },
  '.condarc': { icon: 'file-icons:conda', color: '#44A833' },

  // --- Project Metadata & Version Control ---
  'readme.md': { icon: 'vscode-icons:file-type-markdown' },
  'license': { icon: 'vscode-icons:file-type-license' },
  'license-mit': { icon: 'vscode-icons:file-type-license' },
  'license-apache': { icon: 'vscode-icons:file-type-license' },
  'maintainers': { icon: 'vscode-icons:file-type-text' },
  ...mapExtensions(['.gitignore','.gitattributes', '.gitmodules', '.gitkeep', '.ignore', '.git-blame-ignore-revs'], { icon: 'simple-icons:git', color: '#F05032' }),
  '.mailmap': { icon: 'simple-icons:git', color: '#F05032' },
  
  // --- Miscellaneous ---
  'androidmanifest.xml': { icon: 'devicon:android' },
  'modelfile': { icon: 'devicon:ollama' },
};

// ============================================================================
// TIER 2: EXTENSION MATCHES
// ============================================================================
// Standard Priority: Matches the file extension (everything after the last dot). 
// ============================================================================

export const EXTENSION_MAP: Record<string, ResolvedIcon> = {
  
  // ============================================================================
  // --- Web, UI & Styling ---
  // ============================================================================

  // --- Markup & Frontend ---
  ...mapExtensions(['html', 'htm'], { icon: 'vscode-icons:file-type-html' }),
  ...mapExtensions(['tsx', 'jsx'], { icon: 'logos:react' }),
  'vue': { icon: 'logos:vue' },
  'htmx': { icon: 'devicon:htmx' },
  'webmanifest': { icon: 'vscode-icons:file-type-json' },

  // --- Styling, CSS & Preprocessors ---
  'css': { icon: 'vscode-icons:file-type-css' },
  ...mapExtensions(['scss', 'sass'], { icon: 'vscode-icons:file-type-scss' }),
  'less': { icon: 'vscode-icons:file-type-less' },
  ...mapExtensions(['styl', 'stylus'], { icon: 'vscode-icons:file-type-stylus' }),

  // --- Fonts & Typography ---
  ...mapExtensions(['ttf', 'otf', 'woff', 'woff2', 'eot'], { icon: 'vscode-icons:file-type-font' }),


  // ============================================================================
  // --- Scripting & Functional Languages ---
  // ============================================================================

  // --- JavaScript Ecosystem ---
  'js': { icon: 'logos:javascript' },
  'mjs': { icon: 'logos:nodejs-icon' },
  'ts': { icon: 'logos:typescript-icon' },
  'coffee': { icon: 'devicon:coffeescript' },

  // --- General Scripting & Templating ---
  'php': { icon: 'vscode-icons:file-type-php' },
  'lua': { icon: 'devicon:lua' },
  ...mapExtensions(['rb', 'erb'], { icon: 'vscode-icons:file-type-ruby' }),
  ...mapExtensions(['pl', 'pm', 't'], { icon: 'simple-icons:perl', color: '#39457E' }),
  ...mapExtensions(['jinja', 'jinja2', 'j2'], { icon: 'file-icons:jinja', color: '#B41717' }),
  'twig': { icon: 'file-icons:twig', color: '#A1C900' },
  ...mapExtensions(['ggl', 'graphql'], { icon: 'file-icons:graphql', color: '#E10098' }),

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


  // ============================================================================
  // --- Systems, Compiled & Low-Level Languages ---
  // ============================================================================

  // --- C/C++ & Modern Systems ---
  ...mapExtensions(['c', 'h', 'def'], { icon: 'devicon:embeddedc' }),
  ...mapExtensions(['cpp', 'cppm', 'inl'], { icon: 'vscode-icons:file-type-cpp' }),
  'hpp': { icon: 'vscode-icons:file-type-cppheader' },
  'modulemap': { icon: 'simple-icons:llvm', color: '#1084D0' },
  'natvis': { icon: 'devicon:visualstudio' },
  'rs': { icon: 'simple-icons:rust', color: '#DEA584' },
  'go': { icon: 'vscode-icons:file-type-go' },
  'zig': { icon: 'simple-icons:zig', color: '#F7A41D' },
  'swift': { icon: 'simple-icons:swift', color: '#F05138' },
  'nim': { icon: 'simple-icons:nim', color: '#FFE953' },
  'd': { icon: 'vscode-icons:file-type-dlang' },
  'odin': { icon: 'local:odin' },
  'c3': { icon: 'local:c3' },
  'carbon': { icon: 'local:carbon' },

  // --- Assembly, Compilers, & Binaries ---
  ...mapExtensions(['ll', 'llvm', 'td'], { icon: 'devicon:llvm' }),
  ...mapExtensions(['ld', 'lds', 'asm', 's'], { icon: 'vscode-icons:file-type-assembly' }),
  ...mapExtensions(['o', 'so', 'dll', 'fd'], { icon: 'vscode-icons:file-type-binary' }),
  'wasm': { icon: 'simple-icons:webassembly', color: '#654FF0' },
  'nasm': { icon: 'logos:nasm' },
  'cmake': { icon: 'vscode-icons:file-type-cmake' },
  'mk': { icon: 'vscode-icons:file-type-makefile' },

  // --- Hardware & Embedded (Linux/OS Dev) ---
  ...mapExtensions(['dts', 'dtsi'], { icon: 'devicon:embeddedc' }),
  'nsh': { icon: 'file-icons:terminal', color: '#4CAF50' },


  // ============================================================================
  // --- Enterprise, JVM & .NET ---
  // ============================================================================

  // --- JVM Ecosystem ---
  'java': { icon: 'vscode-icons:file-type-java' },
  'class': { icon: 'vscode-icons:file-type-class' },
  ...mapExtensions(['jar', 'war', 'ear'], { icon: 'vscode-icons:file-type-jar' }),
  'kt': { icon: 'simple-icons:kotlin', color: '#7F52FF' },
  'scala': { icon: 'devicon:scala' },
  'groovy': { icon: 'vscode-icons:file-type-groovy' },

  // --- .NET & Enterprise Scripting ---
  ...mapExtensions(['fs', 'fsx'], { icon: 'vscode-icons:file-type-fsharp' }),
  'cs': { icon: 'vscode-icons:file-type-csharp' },
  'vb': { icon: 'vscode-icons:file-type-vb' },
  'dart': { icon: 'simple-icons:dart', color: '#779ECB' },


  // ============================================================================
  // --- Data Science, Math, AI & Databases ---
  // ============================================================================

  // --- Data Science & AI ---
  ...mapExtensions(['py', 'pyi', 'pyw', 'pyc', 'pyo', 'pyd', 'py3'], { icon: 'vscode-icons:file-type-python' }),
  ...mapExtensions(['rdata', 'rds'], { icon: 'file-icons:rdata', color: '#276DC3' }),
  ...mapExtensions(['nb', 'wl'], { icon: 'file-icons:mathematica', color: '#DD1100' }),
  ...mapExtensions(['pt', 'pth'], { icon: 'devicon:pytorch' }),
  ...mapExtensions(['mojo', '🔥'], { icon: 'vscode-icons:file-type-mojo' }),
  'jl': { icon: 'devicon:julia' },
  'm': { icon: 'vscode-icons:file-type-matlab' }, // Note: Also collides with Objective-C
  'sas': { icon: 'file-icons:sas', color: '#035CA4' },
  'ipynb': { icon: 'simple-icons:jupyter', color: '#F37626' },
  'r': { icon: 'devicon:r' },

  // --- Databases, Caching & Storage Engines ---
  ...mapExtensions(['db','db3', 'sqlite', 'sqlite3'], { icon: 'file-icons:sqlite', color: '#003B57' }),
  'sql': { icon: 'vscode-icons:file-type-sql' },
  ...mapExtensions(['backup'], { icon: 'devicon:postgresql' }), 
  ...mapExtensions(['wt', 'ns', 'bson'], { icon: 'devicon:mongodb' }),
  ...mapExtensions(['rdb', 'aof'], { icon: 'devicon:redis' }),
  ...mapExtensions(['dbf', 'ctl', 'ora'], { icon: 'devicon:oracle' }),
  ...mapExtensions(['mdf', 'ldf', 'ndf'], { icon: 'devicon:microsoftsqlserver' }),
  ...mapExtensions(['frm', 'ibd', 'myd', 'myi', 'opt'], { icon: 'devicon:mysql' }),
  'dat': { icon: 'icon-park-outline:file-hash-one', color: '#2E8B73' }, 


  // ============================================================================
  // --- Hardware, Graphics & Game Dev ---
  // ============================================================================

  // --- Hardware & Shaders ---
  ...mapExtensions(['v', 'sv', 'svh'], { icon: 'vscode-icons:file-type-systemverilog' }),
  ...mapExtensions(['glsl', 'vert', 'frag'], { icon: 'file-icons:opengl', color: '#5586A4' }),
  'spv': { icon: 'file-icons:khronos', color: '#CC292B' }, // SPIR-V
  'cso': { icon: 'file-icons:opengl', color: '#5586A4' }, // Compiled Shader Object
  ...mapExtensions(['cu', 'cuh'], { icon: 'file-icons:nvidia', color: '#76B900' }),
  'ino': { icon: 'devicon:arduino' },
  'webgl': { icon: 'file-icons:webgl', color: '#990000' },
  'wgsl': { icon: 'devicon:webgpu' },

  // --- Game Engines & 3D Assets ---
  ...mapExtensions(['unity', 'prefab'], { icon: 'devicon:unity' }),
  'gd': { icon: 'simple-icons:godotengine', color: '#478CBF' },
  'blend': { icon: 'devicon:blender' },
  'uc': { icon: 'file-icons:unrealscript', color: '#7A7A7A' },

  // from icon park collection in icones.js.org
  ...mapExtensions(['obj', 'fbx', 'gltf', 'glb', 'stl'], { icon: 'icon-park-outline:cube' , color: '#87CEEB'}),


  // ============================================================================
  // --- OS, Shells, Security & Infrastructure ---
  // ============================================================================

  // --- Shells & Scripts ---
  ...mapExtensions(['ps1', 'psm1'], { icon: 'vscode-icons:file-type-powershell' }),
  ...mapExtensions(['bat', 'cmd'], { icon: 'file-icons:ms-dos', color: '#C4C4C4' }),
  'sh': { icon: 'logos:bash-icon' },
  'bash': { icon: 'skill-icons:linux-light' },
  'zsh': { icon: 'logos:zsh', color: '#89E051' },
  'fish': { icon: 'file-icons:terminal', color: '#4CAF50' },
  'wasi': { icon: 'file-icons:wasi', color: '#654FF0' },

  // --- Security & Certificates ---
  ...mapExtensions(['pem', 'crt', 'cer', 'key', 'pub', 'gpg'], { icon: 'vscode-icons:file-type-cert' }),

  // --- Packages & Distros ---
  ...mapExtensions(['exe', 'msi'], { icon: 'logos:microsoft-windows-icon' }), 
  ...mapExtensions(['repo', 'ign', 'kiskstart', 'ks'], { icon: 'logos:fedora' }),
  ...mapExtensions(['deb','ddeb'], { icon: 'logos:debian' }),
  ...mapExtensions(['pkg.tar.zst', 'abs'], { icon: 'logos:archlinux' }),
  'apk': { icon: 'devicon:android' },
  'rpm': { icon: 'logos:redhat-icon' },
  'pkg': { icon: 'logos:freebsd' }, 

  // --- Legacy, Mainframes & Apple Ecosystem ---
  ...mapExtensions(['f', 'f90'], { icon: 'simple-icons:fortran', color: '#734F96' }),
  ...mapExtensions(['ada', 'adb'], { icon: 'vscode-icons:file-type-ada' }),
  ...mapExtensions(['cob', 'cbl'], { icon: 'vscode-icons:file-type-cobol' }),
  ...mapExtensions(['app', 'dmg', 'icns', 'plist', 'dylib', 'framework', 'ipa'], { icon: 'devicon:apple' }),
  'mm': { icon: 'vscode-icons:file-type-objectivec' },

  // --- ZKP & Blockchain ---
  'nr': { icon: 'local:noir' },
  'sol': { icon: 'simple-icons:solidity', color: '#363636' },
  'circom': { icon: 'vscode-icons:file-type-circom' },


  // ============================================================================
  // --- Media, Documents & Data Serialization ---
  // ============================================================================

  // --- Data & Config Serialization ---
  ...mapExtensions(['yml', 'yaml'], { icon: 'vscode-icons:file-type-yaml' }),
  ...mapExtensions(['conf', 'cfg', 'ini'], { icon: 'vscode-icons:file-type-light-ini' }),
  'json': { icon: 'vscode-icons:file-type-json' },
  'toml': { icon: 'vscode-icons:file-type-toml' },
  'xml': { icon: 'vscode-icons:file-type-xml' },
  
  // from icon park collection in icones.js.org
  ...mapExtensions(['csv', 'tsv'], { icon: 'icon-park-outline:file-hash-one', color: '#2E8B73' }),

  // --- Documents & Publishing ---
  ...mapExtensions(['txt', 'rtf', 'in'], { icon: 'vscode-icons:file-type-text' }),
  'log': { icon: 'vscode-icons:file-type-log' },
  'md': { icon: 'vscode-icons:file-type-markdown' },
  'pdf': { icon: 'vscode-icons:file-type-pdf2' },
  ...mapExtensions(['doc', 'docx'], { icon: 'vscode-icons:file-type-word' }),
  ...mapExtensions(['xls', 'xlsx'], { icon: 'vscode-icons:file-type-excel' }),
  ...mapExtensions(['ppt', 'pptx'], { icon: 'vscode-icons:file-type-powerpoint' }),
  'bib': { icon: 'file-icons:bibtex', color: '#e3b341' },
  'tex': { icon: 'simple-icons:latex', color: '#008080' },
  'rst': { icon: 'icon-park-solid:file-code'},
  ...mapExtensions(['dox', 'doxygen'], { icon: 'file-icons:doxygen', color: '#095AAA' }),

  // --- Generic Media (Images, Audio, Video, Archives) ---
  ...mapExtensions(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'fbmp', 'grf'], { icon: 'vscode-icons:file-type-image' }),
  ...mapExtensions(['mp3', 'wav', 'flac', 'ogg'], { icon: 'vscode-icons:file-type-audio' }),
  ...mapExtensions(['mp4', 'mkv', 'avi', 'mov', 'webm'], { icon: 'vscode-icons:file-type-video' }),
  ...mapExtensions(['zip', 'tar', 'gz', '7z', 'rar'], { icon: 'vscode-icons:file-type-zip' }),

  // --- IDE & Workspace Files ---
  ...mapExtensions(['sln', 'csproj'], { icon: 'devicon:visualstudio' }),
  'code-workspace': { icon: 'devicon:vscode' },
  'xcodeproj': { icon: 'devicon:xcode' },
  'vim': { icon: 'devicon:vim' },
  'wrap': { icon: 'file-icons:meson', color: '#882255' },
};