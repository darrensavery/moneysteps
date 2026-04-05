import { useNavigate } from 'react-router-dom'

type Tile = {
  role: 'dad' | 'mum' | 'child'
  initials: string
  name: string
  description: string
  avatarBg: string
  avatarText: string
  nameColor: string
  borderClass: string
  hoverBgClass: string
}

const tiles: Tile[] = [
  {
    role: 'dad',
    initials: 'D',
    name: 'Dad',
    description: 'Manage chores, approve earnings & set goals',
    avatarBg: 'bg-green-100',
    avatarText: 'text-green-800',
    nameColor: 'text-green-800',
    borderClass: 'border-gray-200',
    hoverBgClass: 'hover:bg-green-50 hover:border-green-300',
  },
  {
    role: 'mum',
    initials: 'M',
    name: 'Mum',
    description: 'Manage chores, approve earnings & set goals',
    avatarBg: 'bg-purple-100',
    avatarText: 'text-purple-800',
    nameColor: 'text-purple-800',
    borderClass: 'border-gray-200',
    hoverBgClass: 'hover:bg-purple-50 hover:border-purple-300',
  },
  {
    role: 'child',
    initials: 'A',
    name: 'My Account',
    description: 'Check earnings, progress & savings goals',
    avatarBg: 'bg-teal-100',
    avatarText: 'text-teal-800',
    nameColor: 'text-teal-800',
    borderClass: 'border-teal-300',
    hoverBgClass: 'hover:bg-teal-50 hover:border-teal-400',
  },
]

// Avatar: shows photo if available, otherwise initials
function Avatar({ src, initials, bgClass, textClass }: {
  src?: string
  initials: string
  bgClass: string
  textClass: string
}) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="w-[52px] h-[52px] rounded-full object-cover shrink-0 border border-[#D3D1C7]"
      />
    )
  }
  return (
    <div className={`w-[52px] h-[52px] rounded-full flex items-center justify-center shrink-0 ${bgClass}`}>
      <span className={`text-[20px] font-extrabold ${textClass}`}>{initials}</span>
    </div>
  )
}

export function LandingScreen() {
  const navigate = useNavigate()

  function handleTileClick(tile: Tile) {
    const token = localStorage.getItem('mc_token')

    if (!token) {
      navigate('/signup')
      return
    }

    localStorage.setItem('mc_login_role', tile.role)
    navigate(tile.role === 'child' ? '/pin?role=child' : '/pin?role=parent')
  }

  return (
    <div className="min-h-svh bg-[#F5F4F0] flex flex-col">
      {/* Header */}
      <header className="sticky top-0 bg-white border-b border-[#D3D1C7] shadow-[0_1px_4px_rgba(0,0,0,.05)] px-4 py-3 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center text-white text-sm font-bold">M</div>
        <span className="text-[17px] font-extrabold text-[#1B2D2E] tracking-tight">Morechard</span>
      </header>

      {/* Body */}
      <main className="flex-1 flex flex-col items-center px-3.5 py-8 max-w-[560px] mx-auto w-full">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-extrabold text-[#1C1C1A] tracking-tight mb-1.5">Welcome back</h1>
          <p className="text-[14px] text-[#6b6a66]">Who's signing in today?</p>
        </div>

        <div className="w-full flex flex-col gap-3">
          {tiles.map((tile) => (
            <button
              key={tile.role}
              onClick={() => handleTileClick(tile)}
              className={`
                w-full bg-white border-2 rounded-2xl px-5 py-4
                flex items-center gap-4
                transition-all duration-150
                hover:-translate-y-px hover:shadow-md active:scale-[0.99]
                cursor-pointer text-left
                ${tile.borderClass} ${tile.hoverBgClass}
              `}
            >
              <Avatar
                initials={tile.initials}
                bgClass={tile.avatarBg}
                textClass={tile.avatarText}
              />
              <div className="flex-1 min-w-0">
                <div className={`text-[16px] font-bold ${tile.nameColor}`}>{tile.name}</div>
                <div className="text-[13px] text-[#6b6a66] mt-0.5 leading-snug">{tile.description}</div>
              </div>
              <svg className="text-[#6b6a66] shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6"/>
              </svg>
            </button>
          ))}
        </div>

        {/* New account link */}
        <div className="mt-8 text-center">
          <p className="text-[13px] text-[#6b6a66]">
            New to Morechard?{' '}
            <button
              onClick={() => navigate('/signup')}
              className="text-teal-700 font-semibold underline underline-offset-2 cursor-pointer"
            >
              Create a family account
            </button>
          </p>
        </div>
      </main>
    </div>
  )
}
