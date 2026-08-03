interface SentrylikeLogoProps {
  className?: string;
  size?: number;
}

export function SentrylikeLogo({ className = "", size = 24 }: SentrylikeLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
      fill="none"
    >
      <path
        d="M 256 70 C 330 70 390 92 390 92 V 228 C 390 328 322 396 256 432 C 190 396 122 328 122 228 V 92 C 122 92 182 70 256 70 Z"
        stroke="currentColor"
        strokeWidth="32"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Signal / Pulse Waveform */}
      <path
        d="M 80 256 H 175 L 208 185 L 245 325 L 285 135 L 322 285 L 348 232 L 372 256 H 432"
        stroke="currentColor"
        strokeWidth="32"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
