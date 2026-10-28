/**
 * Hand-picked Instagram posts shown under each barber, by Instagram handle (as in BARBER_INSTAGRAMS). Save each post's
 * picture in public/barbers/posts/ and link it to the post. Up to 3 show; a barber with none just shows no posts.
 */
const posts = (handle: string, file: string) =>
  [1, 2, 3].map((n) => ({ image: `/barbers/posts/${file}${n}.jpg`, link: `https://instagram.com/${handle}` }));

export const BARBER_POSTS: Record<string, { image: string; link: string }[]> = {
  caroscutz: posts("caroscutz", "Caro"),
  joefademaster: posts("joefademaster", "Joe"),
  oscargeorgebarber: posts("oscargeorgebarber", "Oscar"),
};
