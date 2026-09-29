import styles from './retro.module.css';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean };

export function RetroButton({ active, className, type = 'button', ...rest }: Props) {
  return <button type={type} className={`${styles.button} ${className ?? ''}`} data-active={active ? 'true' : undefined} {...rest} />;
}
