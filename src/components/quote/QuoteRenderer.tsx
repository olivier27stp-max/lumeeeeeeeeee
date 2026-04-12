import React from 'react';
import type { QuoteRenderData } from './types';
import MinimalProTemplate from './templates/MinimalProTemplate';

interface QuoteRendererProps {
  data: QuoteRenderData;
  className?: string;
}

export default function QuoteRenderer({ data, className }: QuoteRendererProps) {
  return (
    <div className={className}>
      <MinimalProTemplate data={data} />
    </div>
  );
}
