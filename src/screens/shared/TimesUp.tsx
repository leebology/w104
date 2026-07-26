/**
 * Three seconds long, on both the TV and every phone. Loud, short, and on the
 * same slant as the category banner it replaces.
 */
export function TimesUp() {
  return (
    <main className="screen screen--centered timesup">
      <div className="banner timesup__banner">
        <h1 className="banner__text">TIME’S UP</h1>
      </div>
    </main>
  );
}
