const FIRST_NAMES = [
  "Ana", "Bruno", "Carla", "Diego", "Elaine", "Fábio", "Gabriela", "Henrique",
  "Isabela", "João", "Karina", "Lucas", "Mariana", "Nicolas", "Otávio", "Patrícia",
  "Rafael", "Sabrina", "Tiago", "Vanessa",
];

const LAST_NAMES = [
  "Almeida", "Barbosa", "Cardoso", "Duarte", "Ferreira", "Gonçalves", "Henriques",
  "Lima", "Martins", "Nogueira", "Oliveira", "Pires", "Ribeiro", "Santos", "Teixeira",
];

const CAMPAIGNS = [
  { campaignName: "Apartamentos Itajaí", imovel: "Apartamento" },
  { campaignName: "Casas Centro", imovel: "Casa" },
];

const FAIXAS = ["Até R$300.000", "R$300.000 a R$600.000", "Acima de R$600.000"];

function randomFrom<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function randomPhone() {
  const n = Math.floor(10000000 + Math.random() * 89999999);
  return `+5547${n}`;
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function generateFakeLead() {
  const first = randomFrom(FIRST_NAMES);
  const last = randomFrom(LAST_NAMES);
  const name = `${first} ${last}`;
  const campaign = randomFrom(CAMPAIGNS);
  const suffix = Math.random().toString(36).slice(2, 6);

  return {
    name,
    phone: randomPhone(),
    email: `${slugify(first)}.${slugify(last)}.${suffix}@example.com`,
    source: "manual",
    campaignName: campaign.campaignName,
    customFields: {
      "Qual imóvel você procura?": campaign.imovel,
      "Faixa de investimento": randomFrom(FAIXAS),
      "Tem interesse em financiamento?": randomFrom(["Sim", "Não"]),
      Observação: "Lead fictício gerado para teste",
    },
  };
}
