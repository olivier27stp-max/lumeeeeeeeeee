import { SearchEntityType } from './globalSearchApi';

export function getSearchEntityLabel(type: SearchEntityType) {
  switch (type) {
    case 'client': return 'Clients';
    case 'property': return 'Properties';
    case 'job': return 'Jobs';
    case 'agreement': return 'Agreements';
    case 'lead': return 'Leads';
    case 'invoice': return 'Invoices';
    case 'quote': return 'Quotes';
    case 'request': return 'Requests';
    case 'team': return 'Teams';
    case 'event': return 'Calendar';
    default: return 'Results';
  }
}

export interface SearchItemRefs {
  clientId?: string | null;
  // property → owner client id, agreement → job id
  refId?: string | null;
}

export function getSearchItemHref(type: SearchEntityType, id: string, refs?: SearchItemRefs) {
  switch (type) {
    case 'client': return `/clients/${id}`;
    // property lives on the owner client hub, in the properties section
    case 'property': {
      const clientId = refs?.clientId || refs?.refId;
      return clientId ? `/clients/${clientId}?property=${id}` : '/clients';
    }
    case 'job': return `/jobs/${id}`;
    // agreement lives on its job hub
    case 'agreement': return refs?.refId ? `/jobs/${refs.refId}` : '/jobs';
    // leads are clients with status='lead' — open the client hub
    case 'lead': return `/clients/${id}`;
    case 'invoice': return `/invoices/${id}`;
    case 'quote': return `/quotes/${id}`;
    case 'request': return `/requests/${id}`;
    case 'team': return `/settings/teams`;
    case 'event': return `/calendar`;
    default: return '/';
  }
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
