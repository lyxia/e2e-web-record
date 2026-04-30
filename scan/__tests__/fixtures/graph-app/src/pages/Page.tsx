import Box from '@/components/Box';
import { Relative } from '../components/Relative';

export const Page = async () => {
  const inline = await import('../components/Inline');
  return [Box, Relative, inline];
};
