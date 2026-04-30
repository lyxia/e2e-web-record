import Box from '@/components/Box';
import { Relative } from '../components/Relative';
import { Card } from '../components';

export const Page = async () => {
  const inline = await import('../components/Inline');
  return [Box, Relative, Card, inline];
};
