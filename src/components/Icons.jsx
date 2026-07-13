// Ícones SVG (traço 1.8, estilo lucide) — evita dependência externa.
const S = ({ children, size = 16, ...p }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" {...p}
  >
    {children}
  </svg>
)

export const IconHeli = (p) => (
  <S {...p}>
    <path d="M3 5h13" />
    <path d="M9.5 5v3" />
    <path d="M6 11.5c0-2 1.6-3.5 3.5-3.5h3c2.5 0 4.5 2 4.5 4.5v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-2z" />
    <path d="M17 12h3.2a1 1 0 0 0 .9-1.4L20 8" />
    <path d="M8 18.5h8" />
    <path d="M10 15.5v3M14 15.5v3" />
  </S>
)

export const IconHospital = (p) => (
  <S {...p}>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M12 8.5v7M8.5 12h7" />
  </S>
)

export const IconPin = (p) => (
  <S {...p}>
    <path d="M12 21s-6.5-5.4-6.5-10.2A6.4 6.4 0 0 1 12 4.3a6.4 6.4 0 0 1 6.5 6.5C18.5 15.6 12 21 12 21z" />
    <circle cx="12" cy="10.8" r="2.3" />
  </S>
)

export const IconTarget = (p) => (
  <S {...p}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 2.5V6M12 18v3.5M2.5 12H6M18 12h3.5" />
  </S>
)

export const IconAmbulance = (p) => (
  <S {...p}>
    <path d="M2.5 7.5h11v9h-11z" />
    <path d="M13.5 10h3.6l3 3v3.5h-6.6" />
    <circle cx="6.5" cy="17.5" r="1.6" />
    <circle cx="16.5" cy="17.5" r="1.6" />
    <path d="M7.5 10v3M6 11.5h3" />
  </S>
)

export const IconClock = (p) => (
  <S {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </S>
)

export const IconCloud = (p) => (
  <S {...p}>
    <path d="M7 18a4.5 4.5 0 1 1 .6-8.96A6 6 0 0 1 19 10.5 3.75 3.75 0 0 1 18.25 18H7z" />
  </S>
)

export const IconAlert = (p) => (
  <S {...p}>
    <path d="M12 4 2.8 19.5h18.4L12 4z" />
    <path d="M12 10v4.2M12 17.2v.1" />
  </S>
)

export const IconCheck = (p) => (
  <S {...p}>
    <path d="M4.5 12.5 10 18 19.5 7" />
  </S>
)

export const IconSettings = (p) => (
  <S {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.47V21a2 2 0 1 1-4 0v-.09a1.6 1.6 0 0 0-1.05-1.47 1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 4.6 15a1.6 1.6 0 0 0-1.47-.97H3a2 2 0 1 1 0-4h.09A1.6 1.6 0 0 0 4.56 9a1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.6 1.6 0 0 0 1.77.32H9a1.6 1.6 0 0 0 .97-1.47V3a2 2 0 1 1 4 0v.09c0 .64.38 1.22.97 1.47a1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.32 1.77V9c.25.59.83.97 1.47.97H21a2 2 0 1 1 0 4h-.09a1.6 1.6 0 0 0-1.47.97z" />
  </S>
)

export const IconFolder = (p) => (
  <S {...p}>
    <path d="M3.5 6.5A2 2 0 0 1 5.5 4.5h4l2 2.5h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-10.5z" />
  </S>
)

export const IconPlus = (p) => (
  <S {...p}>
    <path d="M12 5v14M5 12h14" />
  </S>
)

export const IconPrint = (p) => (
  <S {...p}>
    <path d="M7 8V3.5h10V8" />
    <rect x="4" y="8" width="16" height="8" rx="2" />
    <path d="M7 13.5h10v7H7z" />
  </S>
)

export const IconCopy = (p) => (
  <S {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" transform="translate(2 2)" />
  </S>
)

export const IconSave = (p) => (
  <S {...p}>
    <path d="M5 3.5h11L20.5 8v12.5h-16V3.5z" transform="translate(-0.5 0)" />
    <path d="M8 3.5V9h7V3.5M8 20v-6h8v6" />
  </S>
)

export const IconDownload = (p) => (
  <S {...p}>
    <path d="M12 4v11M7.5 11 12 15.5 16.5 11" />
    <path d="M4.5 19.5h15" />
  </S>
)

export const IconSearch = (p) => (
  <S {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.2-4.2" />
  </S>
)

export const IconEdit = (p) => (
  <S {...p}>
    <path d="M4 20h4l11-11a2.4 2.4 0 0 0-4-4L4 16v4z" />
    <path d="M13.5 6.5 17 10" />
  </S>
)

export const IconLayers = (p) => (
  <S {...p}>
    <path d="m12 3 9 5-9 5-9-5 9-5z" />
    <path d="m4.5 13.5 7.5 4.2 7.5-4.2" />
  </S>
)

export const IconZap = (p) => (
  <S {...p}>
    <path d="M13 2.5 4.5 13.5H11l-1 8L18.5 10.5H13l1-8z" transform="translate(0.5 0)" />
  </S>
)

export const IconSun = (p) => (
  <S {...p}>
    <path d="M4 17h16M7 17a5 5 0 0 1 10 0" />
    <path d="M12 6.5V4M6 9 4.5 7.5M18 9l1.5-1.5" />
  </S>
)

export const IconRoute = (p) => (
  <S {...p}>
    <circle cx="6" cy="18" r="2.2" />
    <circle cx="18" cy="6" r="2.2" />
    <path d="M8 17h7a3.5 3.5 0 0 0 0-7H9a3 3 0 0 1 0-6h6" transform="translate(0 1.5)" />
  </S>
)

export const IconX = (p) => (
  <S {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </S>
)

export const IconUsers = (p) => (
  <S {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19.5c.5-3.5 2.8-5.5 5.5-5.5s5 2 5.5 5.5" />
    <path d="M15.5 5.6a3.2 3.2 0 0 1 0 4.8M17.5 14.3c1.6.8 2.7 2.6 3 5.2" />
  </S>
)

// ---- tipos de área de pouso ----
export const IconFieldSoccer = (p) => (
  <S {...p}>
    <rect x="3" y="6" width="18" height="12" rx="1.5" />
    <path d="M12 6v12" />
    <circle cx="12" cy="12" r="2.2" />
    <path d="M3 9.5h3v5H3M21 9.5h-3v5h3" />
  </S>
)

export const IconStadium = (p) => (
  <S {...p}>
    <ellipse cx="12" cy="12" rx="9" ry="5.5" />
    <ellipse cx="12" cy="12" rx="4.5" ry="2.5" />
  </S>
)

export const IconGrass = (p) => (
  <S {...p}>
    <path d="M4 20c1-4 .5-8-1-11 3 1 5 4 5.5 7M9.5 20C10 14 9 9 7 5.5c4 2 6.5 6 7 10.5M15 20c.3-4.5 2-8 5-10-1.5 3-2 6.5-1.5 10" />
    <path d="M3 20h18" />
  </S>
)

export const IconBeach = (p) => (
  <S {...p}>
    <path d="M3.5 20.5c3-2 6-2 8.5 0 2.5-2 5.5-2 8.5 0" transform="translate(0 -1)" />
    <path d="M13 16 8.5 5.5A6.5 6.5 0 0 1 17 9l-4 7z" />
    <path d="M8.5 5.5C11 5 14.5 6.5 17 9" />
  </S>
)

export const IconParking = (p) => (
  <S {...p}>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M9.5 17V7.5H13a3 3 0 0 1 0 6H9.5" />
  </S>
)

export const IconHelipadH = (p) => (
  <S {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9 8v8M15 8v8M9 12h6" />
  </S>
)

export const IconSport = (p) => (
  <S {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5v17M3.5 12h17" />
    <path d="M6 5.5c1.8 1.7 1.8 11.3 0 13M18 5.5c-1.8 1.7-1.8 11.3 0 13" />
  </S>
)

export const LZ_TYPE_ICON = {
  'Heliponto': IconHelipadH,
  'Ponto da comunidade': IconUsers,
  'Estádio': IconStadium,
  'Campo/quadra': IconFieldSoccer,
  'Área esportiva': IconSport,
  'Praia': IconBeach,
  'Parque/área verde': IconGrass,
  'Área gramada': IconGrass,
  'Estacionamento': IconParking,
}
