import { redirect } from 'next/navigation';

export default function TrackLookupRedirect() {
  redirect('/discover?tab=lookup');
}
