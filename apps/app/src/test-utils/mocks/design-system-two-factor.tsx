import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
} from 'react';

/**
 * Minimal DOM stand-ins for the design-system components used by the 2FA UI,
 * so tests exercise behaviour rather than DS styling internals.
 */
export const designSystemTwoFactorMock = {
  Button: ({
    children,
    loading,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: string }) => (
    <button {...props} disabled={props.disabled || loading}>
      {children}
    </button>
  ),
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Label: ({ children, ...props }: LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>{children}</label>
  ),
  Card: ({
    title,
    description,
    children,
  }: {
    title?: ReactNode;
    description?: ReactNode;
    children?: ReactNode;
  }) => (
    <section>
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </section>
  ),
  Section: ({ title, children }: { title?: ReactNode; children?: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  Stack: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  HStack: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
};
