// @ts-nocheck
import styles from './component.module.css';

export function MyComponent() {
  return (
    <div className={styles.container}>
      <acme-button variant="tertiary" size="small">
        <span slot="start">→</span>
        Click me
      </acme-button>

      <div className={`${styles.header} acme-text-heading-1`}>
        Title
      </div>

      <div className="acme-text-body-default acme-font-weight-bold">
        Body text
      </div>
    </div>
  );
}
