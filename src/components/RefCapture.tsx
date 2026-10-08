'use client';
// Ricorda da quale link si è arrivati (?ref=…), per contare il passaparola.
// Il significato sta in src/lib/share.ts (catturaRef).

import { useEffect } from 'react';
import { catturaRef } from '@/lib/share';

export function RefCapture() {
  useEffect(() => catturaRef(window.location.search), []);
  return null;
}
