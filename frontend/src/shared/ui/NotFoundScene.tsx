import { Button, Container, Group, Text, Title } from "@mantine/core";
import { Link } from "react-router-dom";
import { MaterialSymbol } from "./MaterialSymbol";
import classes from "./notFoundScene.module.css";

/**
 * PLIEGO's missing-page scene (after Mantine's "404 in the background" pattern): a very large, faint numeral behind
 * a centred statement, one line and the way home. One recovery everywhere — "Ir al inicio" — and no technical copy.
 * `code` draws the numeral; a route that failed for another reason states itself without one.
 */
export function NotFoundScene({
  code = "404",
  title = "No encontramos esta página.",
  detail = "Puede que el enlace haya cambiado o que la página ya no esté disponible.",
  headingLevel = 1,
}: {
  code?: string | null;
  title?: string;
  detail?: string;
  headingLevel?: 1 | 2;
}) {
  return <Container size={720} className={classes.scene} data-not-found-scene>
    {code && <div className={classes.numeral} aria-hidden="true">{code}</div>}
    <div className={classes.content}>
      <Title order={headingLevel} className={classes.title} textWrap="balance">{title}</Title>
      <Text className={classes.detail}>{detail}</Text>
      <Group justify="center">
        <Button component={Link} to="/" size="md" radius="xl" className={classes.home} leftSection={<MaterialSymbol name="arrow_back" size={20} aria-hidden="true" />}>Ir al inicio</Button>
      </Group>
    </div>
  </Container>;
}
