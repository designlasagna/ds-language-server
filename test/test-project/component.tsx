import styles from './component.module.css';

export function MyComponent() {
  return (
    <div className={styles.container}>
      <lfds-button variant="tertiary" size="small">
        <span slot="start">→</span>
        Click me
      </lfds-button>

      <div className={`${styles.header} lf-text-heading-1`}>
        Title
      </div>

      <div className="lf-text-body-default lf-font-weight-bold">
        Body text
      </div>
    </div>
  );
}
