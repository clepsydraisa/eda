type PageBlankProps = {
  title: string;
};

export function PageBlank({ title }: PageBlankProps) {
  return (
    <section className="page-blank">
      <h1 className="page-title">{title}</h1>
      <p className="muted">Conteúdo a adicionar em breve…</p>
    </section>
  );
}


