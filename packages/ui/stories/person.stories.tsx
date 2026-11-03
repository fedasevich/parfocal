import type { Meta, StoryObj } from "@storybook/react-vite";
import { AvatarStack, Person, PersonAvatar, PresenceDot } from "../src/components/person.tsx";
import { avatarColours, personFromProfile } from "../src/lib/avatar-colours.ts";
import { people, profiles } from "./fixtures.ts";

const meta = {
  title: "Components/Person",
  decorators: [
    (Story) => (
      <div className="rounded-zone bg-chrome p-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const WithName: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-3">
      <Person person={people.LM} sub />
      <Person person={people.DH} you sub="Researcher" />
      <Person person={people.SM} size={20} short />
      <Person person={people.AK} presence="busy" sub />
      <Person />
    </div>
  ),
};

export const ProfileColours: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      {avatarColours.map((_, index) => {
        const person = personFromProfile({
          display_name: `Colour ${index}`,
          initials: `C${index}`,
          avatar_colour: index,
        });
        return (
          <span key={person.initials} className="grid justify-items-center gap-1">
            <PersonAvatar person={person} size={32} data-testid={`profile-colour-${index}`} />
            <small className="font-mono text-caption text-fg-faint">{index}</small>
          </span>
        );
      })}
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-3">
      {[16, 20, 24, 28, 32, 40].map((size) => (
        <PersonAvatar key={size} person={people.TB} size={size} />
      ))}
    </div>
  ),
};

export const Presence: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-3">
      <Person person={people.LM} presence="available" sub="Available" />
      <Person person={people.JR} presence="busy" sub="Busy until 15:00" />
      <Person person={people.PK} presence="away" sub="Away" />
      <span className="flex items-center gap-3 text-body-sm">
        <PresenceDot presence="available" /> Available
        <PresenceDot presence="busy" /> Busy
        <PresenceDot presence="away" /> Away
      </span>
    </div>
  ),
};

export const Stack: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-4">
      <AvatarStack
        data-testid="stack-overflow"
        people={[people.LM, people.SM, people.AK, people.JR, people.TB]}
      />
      <AvatarStack data-testid="stack-fits" people={[people.HL, people.MV]} size={22} />
      <AvatarStack
        data-testid="stack-from-profiles"
        people={Object.values(profiles).map(personFromProfile)}
        max={4}
        size={28}
      />
    </div>
  ),
};
