import { sileo } from 'sileo';
import type { ReactNode } from 'react';

type Opts = {
  description?: ReactNode;
  duration?: number;
  button?: { title: string; onClick: () => void };
  expand?: boolean;
};

const buildOpts = (title: string, o?: Opts) => ({
  title,
  description: o?.description,
  duration: o?.duration,
  button: o?.button,
});

export const notify = {
  success: (title: string, opts?: Opts) =>
    sileo.success(buildOpts(title, opts)),

  error: (title: string, opts?: Opts) =>
    sileo.error(buildOpts(title, opts)),

  info: (title: string, opts?: Opts) =>
    sileo.info(buildOpts(title, opts)),

  warning: (title: string, opts?: Opts) =>
    sileo.warning(buildOpts(title, opts)),

  loading: (title: string, opts?: Opts) =>
    sileo.show({ type: 'loading', ...buildOpts(title, opts) }),

  dismiss: (id: string) => sileo.dismiss(id),
  clear: () => sileo.clear(),

  promise: <T>(
    p: Promise<T>,
    msgs: {
      loading: string;
      success: string | ((data: T) => string);
      error?: string | ((err: unknown) => string);
      successDesc?: ReactNode | ((data: T) => ReactNode);
      successButton?: { title: string; onClick: (data: T) => void };
    }
  ): Promise<T> => {
    return sileo.promise<T>(p, {
      loading: { title: msgs.loading },
      success: (data) => {
        const title = typeof msgs.success === 'function' ? msgs.success(data) : msgs.success;
        const description = typeof msgs.successDesc === 'function' ? msgs.successDesc(data) : msgs.successDesc;
        return {
          title,
          description,
          button: msgs.successButton
            ? { title: msgs.successButton.title, onClick: () => msgs.successButton!.onClick(data) }
            : undefined,
        };
      },
      error: (err) => {
        const title = typeof msgs.error === 'function'
          ? msgs.error(err)
          : msgs.error ?? 'Algo salió mal';
        const e = err as { response?: { data?: { error?: string; mensaje?: string } }; message?: string };
        const detalle = e?.response?.data?.error ?? e?.response?.data?.mensaje ?? e?.message;
        return { title, description: detalle };
      },
    });
  },
};
