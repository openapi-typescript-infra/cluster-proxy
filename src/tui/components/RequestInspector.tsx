import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { CapturedRequest } from '../types.ts';

interface Props {
  request: CapturedRequest | undefined;
  onBack: () => void;
  maxLines?: number;
}

function formatHeaders(headers: Record<string, string | string[] | undefined>): string {
  return Object.entries(headers)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `  ${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join('\n');
}

function formatBody(body: Buffer | null, truncated: boolean): string {
  if (!body || body.length === 0) {
    return '  (empty)';
  }

  const text = body.toString('utf-8');
  try {
    const parsed = JSON.parse(text);
    const pretty = JSON.stringify(parsed, null, 2);
    const lines = pretty.split('\n');
    const display = lines.length > 50 ? lines.slice(0, 50).join('\n') + '\n  ...' : pretty;
    return display + (truncated ? '\n  (body truncated)' : '');
  } catch {
    // Not JSON, show raw text
    const lines = text.split('\n');
    const display = lines.length > 50 ? lines.slice(0, 50).join('\n') + '\n  ...' : text;
    return display + (truncated ? '\n  (body truncated)' : '');
  }
}

export function RequestInspector({ request, onBack, maxLines = 30 }: Props) {
  const [scroll, setScroll] = useState(0);

  useInput((input, key) => {
    if (key.escape || input === 'b') {
      onBack();
      return;
    }
    if (key.upArrow) {
      setScroll((s) => Math.max(0, s - 1));
    }
    if (key.downArrow) {
      setScroll((s) => s + 1);
    }
  });

  if (!request) {
    return <Text>Request not found</Text>;
  }

  const lines: { text: string; color?: string; bold?: boolean }[] = [];

  lines.push({
    text: ` ${request.method} ${request.url} (${request.protocol}) `,
    bold: true,
  });
  lines.push({ text: '' });
  lines.push({ text: `Host: ${request.fullHost}`, color: 'cyan' });
  lines.push({ text: `Target: ${request.target}` });
  lines.push({
    text: `Status: ${request.statusCode ?? 'pending'}`,
    color: request.statusCode
      ? request.statusCode < 300
        ? 'green'
        : request.statusCode < 400
          ? 'yellow'
          : 'red'
      : 'gray',
  });
  lines.push({
    text: `Duration: ${request.duration !== null ? `${request.duration}ms` : 'pending'}`,
  });
  lines.push({
    text: `Registered: ${request.isRegistered ? 'yes' : 'no (cluster forward)'}`,
  });

  if (request.error) {
    lines.push({ text: '' });
    lines.push({ text: `Error: ${request.error}`, color: 'red' });
  }

  lines.push({ text: '' });
  lines.push({ text: 'Request Headers', bold: true });
  lines.push({ text: formatHeaders(request.requestHeaders) });

  if (request.requestBody && request.requestBody.length > 0) {
    lines.push({ text: '' });
    lines.push({
      text: `Request Body${request.requestBodyTruncated ? ' (truncated)' : ''}`,
      bold: true,
    });
    lines.push({ text: formatBody(request.requestBody, request.requestBodyTruncated) });
  }

  lines.push({ text: '' });
  lines.push({ text: 'Response Headers', bold: true });
  if (request.responseHeaders) {
    lines.push({ text: formatHeaders(request.responseHeaders) });
  } else {
    lines.push({ text: '  (pending)' });
  }

  if (request.responseBody && request.responseBody.length > 0) {
    lines.push({ text: '' });
    lines.push({
      text: `Response Body${request.responseBodyTruncated ? ' (truncated)' : ''}`,
      bold: true,
    });
    lines.push({ text: formatBody(request.responseBody, request.responseBodyTruncated) });
  }

  // Flatten multi-line text entries into individual lines
  const allLines: typeof lines = [];
  for (const line of lines) {
    const subLines = line.text.split('\n');
    for (const sub of subLines) {
      allLines.push({ ...line, text: sub });
    }
  }

  const visibleCount = Math.max(1, maxLines - 1);
  const visibleLines = allLines.slice(scroll, scroll + visibleCount);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold inverse>
        {' '}
        Request Inspector{' '}
      </Text>
      {visibleLines.map((line, i) => (
        <Text key={scroll + i} bold={line.bold} color={line.color as never}>
          {line.text}
        </Text>
      ))}
    </Box>
  );
}
