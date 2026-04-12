import React from 'react';

export default function EmptyStateIllustration() {
  return (
    <svg
      width="200"
      height="180"
      viewBox="0 0 200 180"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Person sitting cross-legged */}
      {/* Head */}
      <ellipse cx="100" cy="38" rx="18" ry="20" stroke="#1F2937" strokeWidth="2" fill="none" />

      {/* Hair (curly/wavy on top) */}
      <path
        d="M82 32 C82 18 92 10 100 10 C108 10 118 18 118 32"
        stroke="#1F2937"
        strokeWidth="2"
        fill="#1F2937"
      />
      <path
        d="M82 32 C80 26 82 18 88 14"
        stroke="#1F2937"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M118 32 C120 26 118 18 112 14"
        stroke="#1F2937"
        strokeWidth="2"
        fill="none"
      />
      {/* Extra curls */}
      <circle cx="86" cy="20" r="4" fill="#1F2937" />
      <circle cx="94" cy="14" r="5" fill="#1F2937" />
      <circle cx="106" cy="14" r="5" fill="#1F2937" />
      <circle cx="114" cy="20" r="4" fill="#1F2937" />
      <circle cx="100" cy="12" r="4" fill="#1F2937" />

      {/* Body / Torso */}
      <path
        d="M90 56 C90 56 88 80 88 90 L112 90 C112 80 110 56 110 56"
        stroke="#1F2937"
        strokeWidth="2"
        fill="none"
      />

      {/* Arms */}
      {/* Left arm - reaching down to cat */}
      <path
        d="M88 65 C78 70 72 82 76 95"
        stroke="#1F2937"
        strokeWidth="2"
        fill="none"
      />
      {/* Right arm - resting on knee */}
      <path
        d="M112 65 C122 70 130 82 126 95"
        stroke="#1F2937"
        strokeWidth="2"
        fill="none"
      />

      {/* Legs crossed */}
      {/* Left leg */}
      <path
        d="M88 90 C84 100 70 110 65 120 C60 128 72 132 80 125 C88 118 95 108 100 100"
        stroke="#1F2937"
        strokeWidth="2"
        fill="none"
      />
      {/* Right leg */}
      <path
        d="M112 90 C116 100 130 110 135 120 C140 128 128 132 120 125 C112 118 105 108 100 100"
        stroke="#1F2937"
        strokeWidth="2"
        fill="none"
      />

      {/* Cat sitting on lap */}
      {/* Cat body */}
      <ellipse cx="100" cy="108" rx="14" ry="10" stroke="#9CA3AF" strokeWidth="1.5" fill="#F3F4F6" />

      {/* Cat head */}
      <circle cx="100" cy="94" r="8" stroke="#9CA3AF" strokeWidth="1.5" fill="#F3F4F6" />

      {/* Cat ears */}
      <path d="M94 88 L91 80 L96 86" stroke="#9CA3AF" strokeWidth="1.5" fill="#F3F4F6" />
      <path d="M106 88 L109 80 L104 86" stroke="#9CA3AF" strokeWidth="1.5" fill="#F3F4F6" />

      {/* Cat eyes */}
      <circle cx="97" cy="93" r="1.2" fill="#1F2937" />
      <circle cx="103" cy="93" r="1.2" fill="#1F2937" />

      {/* Cat nose */}
      <path d="M99 95.5 L100 96.5 L101 95.5" stroke="#9CA3AF" strokeWidth="1" fill="none" />

      {/* Cat whiskers */}
      <line x1="90" y1="94" x2="96" y2="94.5" stroke="#9CA3AF" strokeWidth="0.8" />
      <line x1="90" y1="96" x2="96" y2="95.5" stroke="#9CA3AF" strokeWidth="0.8" />
      <line x1="110" y1="94" x2="104" y2="94.5" stroke="#9CA3AF" strokeWidth="0.8" />
      <line x1="110" y1="96" x2="104" y2="95.5" stroke="#9CA3AF" strokeWidth="0.8" />

      {/* Cat tail */}
      <path
        d="M114 108 C120 106 126 100 124 94"
        stroke="#9CA3AF"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />

      {/* Heart on cat */}
      <path
        d="M98 104 C98 102.5 96 101.5 95 102.5 C94 103.5 95 105 98 107 C101 105 102 103.5 101 102.5 C100 101.5 98 102.5 98 104Z"
        fill="#D1D5DB"
        stroke="none"
      />

      {/* Small motion lines around person */}
      <line x1="70" y1="55" x2="65" y2="50" stroke="#D1D5DB" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="68" y1="62" x2="62" y2="60" stroke="#D1D5DB" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="130" y1="55" x2="135" y2="50" stroke="#D1D5DB" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="132" y1="62" x2="138" y2="60" stroke="#D1D5DB" strokeWidth="1.5" strokeLinecap="round" />

      {/* Ground shadow */}
      <ellipse cx="100" cy="140" rx="40" ry="4" fill="#E5E7EB" opacity="0.5" />
    </svg>
  );
}
