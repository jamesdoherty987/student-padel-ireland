type SpotlightProps = {
  className?: string
  fill?: string
}

/** Aceternity-inspired spotlight SVG — CSS animation in Landing.css / index.css */
export function Spotlight({ className = '', fill = 'white' }: SpotlightProps) {
  return (
    <svg
      className={`spotlight ${className}`.trim()}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 3787 2842"
      fill="none"
      aria-hidden
    >
      <g filter="url(#lp-spotlight-filter)">
        <ellipse
          cx="1924.71"
          cy="273.501"
          rx="1924.71"
          ry="273.501"
          transform="matrix(-0.822377 -0.568943 -0.568943 0.822377 3631.88 2291.09)"
          fill={fill}
          fillOpacity="0.22"
        />
      </g>
      <defs>
        <filter
          id="lp-spotlight-filter"
          x="0.860352"
          y="0.838989"
          width="3785.16"
          height="2840.26"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="151" result="effect1_foregroundBlur" />
        </filter>
      </defs>
    </svg>
  )
}
