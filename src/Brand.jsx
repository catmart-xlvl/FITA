import React,{useId} from 'react';
import {PRODUCT_NAME} from '../shared/product.js';

// FITA wordmark (white with a dark outline): heavy condensed type (Impact; Anton / Arial Black fallback), slightly thinned with an SVG erode.
// No glow at rest; CSS adds it on hover.
// textLength keeps the same footprint whichever fallback font is used.
// className: 'topbar-brand' (library, centered) or 'sidebar-logo' (inside a project).
export default function Brand({onClick,label=PRODUCT_NAME,className='topbar-brand'}){
  const gradient='fita-'+useId().replace(/[^a-zA-Z0-9_-]/g,''),thin=gradient+'-thin';
  return <button type="button" className={'neon-brand '+className} onClick={onClick} aria-label={label} title={label}>
    <svg viewBox="0 0 164 54" aria-hidden="true">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff"/><stop offset=".6" stopColor="#f7f9fc"/><stop offset="1" stopColor="#dde4ec"/>
        </linearGradient>
        <filter id={thin} x="-5%" y="-5%" width="110%" height="110%"><feMorphology operator="erode" radius=".45"/></filter>
      </defs>
      <text className="brand-word" x="82" y="48" textAnchor="middle" textLength="150" lengthAdjust="spacingAndGlyphs" fill={`url(#${gradient})`} filter={`url(#${thin})`}>{PRODUCT_NAME}</text>
    </svg>
  </button>;
}
