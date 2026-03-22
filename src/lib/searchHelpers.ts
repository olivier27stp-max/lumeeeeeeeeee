import { SearchEntityType } from './globalSearchApi';

export function getSearchEntityLabel(type: SearchEntityType) {
  switch (type) {
    case 'client': return 'Clients';
    case 'job': return 'Jobs';
    case 'lead': return 'Leads';
    case 'invoice': return 'Invoices';
    case 'quote': return 'Quotes';
    case 'team': return 'Teams';
    case 'event': return 'Calendar';
    default: return 'Results';
  }
}

export function getSearchItemHref(type: SearchEntityType, id: string) {
  switch (type) {
    case 'client': return `/clients/${id}`;
    case 'job': return `/jobs/${id}`;
    case 'lead': return `/pipeline?leadId=${id}`;
    case 'invoice': return `/invoices/${id}`;
    case 'quote': return `/quotes?quoteId=${id}`;
    case 'team': return `/settings/teams`;
    case 'event': return `/calendar`;
    default: return '/';
  }
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
