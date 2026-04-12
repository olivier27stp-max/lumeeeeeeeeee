import React from 'react';
import type { InvoiceRenderData } from './types';
import CleanBillingTemplate from './templates/CleanBillingTemplate';

interface InvoiceRendererProps {
  data: InvoiceRenderData;
  className?: string;
}

export default function InvoiceRenderer({ data, className }: InvoiceRendererProps) {
  return (
    <div className={className}>
      <CleanBillingTemplate data={data} />
    </div>
  );
}
